-- =============================================================================
-- 20260501121000_agenda.sql
-- Capa 2 · Agenda — tabla única `agenda_events` con tipo discriminado.
--
-- Recoge: visitas, instalaciones (proxy), llamadas, mantenimientos (proxy),
-- recordatorios, tareas manuales, seguimiento de incidencias.
-- (Las instalaciones, mantenimientos e incidencias tienen tablas propias;
-- los eventos de agenda son la VISIÓN unificada para el calendario.)
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'agenda_event_kind') then
    create type app.agenda_event_kind as enum (
      'visit',                -- visita comercial
      'installation',         -- proxy de installations.scheduled_at
      'maintenance',          -- proxy de maintenance.scheduled_at
      'call',                 -- llamada programada
      'reminder',             -- recordatorio puntual
      'manual',               -- tarea manual
      'incident_followup',    -- seguimiento de incidencia
      'meeting'               -- reunión interna
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'agenda_event_status') then
    create type app.agenda_event_status as enum (
      'scheduled','in_progress','completed','cancelled','no_show','rescheduled'
    );
  end if;
end $$;

create table public.agenda_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,

  kind            app.agenda_event_kind not null,
  status          app.agenda_event_status not null default 'scheduled',
  title           text not null,
  description     text,

  -- Cuándo
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  all_day         boolean not null default false,
  -- Si es fuera del horario comercial de la empresa, marcar para aviso UX
  is_outside_hours boolean not null default false,

  -- Quién
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,

  -- Qué entidad relaciona (subject_type opcional para enlazar)
  subject_type    app.subject_type,
  subject_id      uuid,

  -- Ubicación (opcional: agenda no siempre tiene dirección)
  address_id      uuid references public.addresses(id) on delete set null,
  geo_latitude    numeric(9,6),
  geo_longitude   numeric(9,6),

  -- Recordatorios (array de minutos antes para enviar notificación)
  reminders_min_before integer[] default array[60]::integer[],

  -- Auditoría
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  check (ends_at is null or ends_at >= starts_at)
);

create index idx_agenda_company_starts on public.agenda_events(company_id, starts_at);
create index idx_agenda_assigned on public.agenda_events(company_id, assigned_user_id, starts_at);
create index idx_agenda_subject on public.agenda_events(company_id, subject_type, subject_id);
create index idx_agenda_kind on public.agenda_events(company_id, kind);
create index idx_agenda_status on public.agenda_events(company_id, status);

create trigger trg_agenda_updated
  before update on public.agenda_events
  for each row execute function app.set_updated_at();

comment on table public.agenda_events is
  'Tabla única de eventos de agenda. Tipo discriminado. Las instalaciones/mantenimientos generan automáticamente entradas via trigger.';

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.agenda_events enable row level security;
alter table public.agenda_events force row level security;

drop policy if exists agenda_super on public.agenda_events;
create policy agenda_super on public.agenda_events
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists agenda_select_by_scope on public.agenda_events;
create policy agenda_select_by_scope on public.agenda_events
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('agenda','view','all_company')
      or (app.can('agenda','view','department') and exists (
            select 1 from public.user_roles ur
            join public.roles_catalog rc on rc.key = ur.role_key
            where ur.user_id = agenda_events.assigned_user_id
              and ur.company_id = app.current_company_id()
              and ur.revoked_at is null
              and rc.default_department = any(app.current_user_departments()::app.department_kind[])
         ))
      or (app.can('agenda','view','own') and (
            assigned_user_id = auth.uid()
            or created_by = auth.uid()
         ))
    )
  );

drop policy if exists agenda_insert_by_scope on public.agenda_events;
create policy agenda_insert_by_scope on public.agenda_events
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      app.can('agenda','create','all_company')
      or app.can('agenda','create','department')
      or app.can('agenda','create','own')
    )
  );

drop policy if exists agenda_update_by_scope on public.agenda_events;
create policy agenda_update_by_scope on public.agenda_events
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('agenda','update','all_company')
      or (app.can('agenda','update','own') and (
            assigned_user_id = auth.uid()
            or created_by = auth.uid()
         ))
    )
  )
  with check (company_id = app.current_company_id());

drop policy if exists agenda_delete_admin on public.agenda_events;
create policy agenda_delete_admin on public.agenda_events
  for delete to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.has_role('company_admin')
      or created_by = auth.uid()
    )
  );
