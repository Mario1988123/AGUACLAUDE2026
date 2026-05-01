-- =============================================================================
-- 20260501121600_installations.sql
-- Capa 2 · Módulo Instalaciones — parte de trabajo táctil.
--
-- Tablas:
--   - installations                 instalación (1 por cliente/dirección/equipo)
--   - installation_items            equipos instalados
--   - installation_steps_log        cronómetro / pausas / reanudaciones
--   - installation_photos           fotos obligatorias y opcionales
--   - installation_signatures       firmas (cliente)
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'installation_kind') then
    create type app.installation_kind as enum (
      'normal',           -- viene de contrato firmado
      'free_trial',       -- viene de free_trial
      'relocation'        -- reubicación libre
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'installation_status') then
    create type app.installation_status as enum (
      'unscheduled','scheduled','in_progress','paused',
      'completed','cancelled','incident_pending'
    );
  end if;
end $$;

create table public.installations (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  kind                        app.installation_kind not null,
  status                      app.installation_status not null default 'unscheduled',
  reference_code              text,

  -- Origen (uno de estos según kind)
  contract_id                 uuid references public.contracts(id) on delete restrict,
  free_trial_id               uuid references public.free_trials(id) on delete restrict,

  -- Cliente y dirección
  customer_id                 uuid references public.customers(id) on delete restrict,
  address_id                  uuid references public.addresses(id) on delete restrict,

  -- Asignación (decisión 1.7: instalador asignado pierde acceso al completar)
  installer_user_id           uuid references auth.users(id) on delete set null,
  assigned_at                 timestamptz,
  assigned_by                 uuid references auth.users(id) on delete set null,

  -- Vehículo de origen para descontar stock
  source_warehouse_id         uuid references public.warehouses(id),

  -- Programación
  scheduled_at                timestamptz,
  preferred_time_slot         text,                                      -- "mañana", "tarde", "9h-12h"

  -- Inicio / fin parte de trabajo
  started_at                  timestamptz,
  completed_at                timestamptz,
  duration_seconds            integer,

  -- Geo
  geo_started_lat             numeric(9,6),
  geo_started_lng             numeric(9,6),
  geo_completed_lat           numeric(9,6),
  geo_completed_lng           numeric(9,6),
  geo_distance_to_address_m   integer,
  -- Si geo_distance_to_address_m > umbral company_settings -> incidencia

  -- Cuestionario inicial (decisión flujo)
  has_previous_damage         boolean,
  needs_countertop_drilling   boolean,

  -- Mantenimientos confirmados al terminar
  maintenance_included        boolean,
  maintenance_periodicity_months integer,
  maintenance_months_included integer,
  maintenance_extra_cents     integer,

  -- Documentos generados
  work_report_pdf_id          uuid references public.documents(id) on delete set null,

  -- Si fue cancelado/incidencia
  cancelled_reason            text,
  incident_id                 uuid,                                      -- FK forward

  notes                       text,
  created_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,

  -- Validaciones
  check (
    (kind = 'normal' and contract_id is not null)
    or (kind = 'free_trial' and free_trial_id is not null)
    or (kind = 'relocation')
  )
);

create index idx_inst_company_status on public.installations(company_id, status) where deleted_at is null;
create index idx_inst_installer on public.installations(installer_user_id, status) where deleted_at is null and installer_user_id is not null;
create index idx_inst_customer on public.installations(company_id, customer_id) where customer_id is not null;
create index idx_inst_scheduled on public.installations(company_id, scheduled_at) where scheduled_at is not null;
create index idx_inst_contract on public.installations(contract_id) where contract_id is not null;
create index idx_inst_freetrial on public.installations(free_trial_id) where free_trial_id is not null;

create trigger trg_inst_updated
  before update on public.installations
  for each row execute function app.set_updated_at();

-- Cerrar FK forward de stock_movements
alter table public.stock_movements
  add constraint sm_installation_fk
  foreign key (installation_id) references public.installations(id) on delete set null;

-- =============================================================================
-- installation_items
-- =============================================================================
create table public.installation_items (
  id                  uuid primary key default gen_random_uuid(),
  installation_id     uuid not null references public.installations(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  quantity            integer not null default 1 check (quantity > 0),
  serial_number       text,
  notes               text,
  display_order       integer not null default 0
);

create index idx_ii_installation on public.installation_items(installation_id);

-- =============================================================================
-- installation_steps_log (cronómetro: pausas, reanudaciones, cambios de estado)
-- =============================================================================
create table public.installation_steps_log (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  event_type      text not null check (event_type in ('start','pause','resume','complete','geo_check','damage_report','drilling_report')),
  event_at        timestamptz not null default now(),
  event_user_id   uuid references auth.users(id),
  payload         jsonb default '{}'::jsonb,
  geo_latitude    numeric(9,6),
  geo_longitude   numeric(9,6)
);

create index idx_isl_installation on public.installation_steps_log(installation_id, event_at);

-- =============================================================================
-- installation_photos
-- =============================================================================
create table public.installation_photos (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  storage_path    text not null,
  category        text not null check (category in (
    'previous_damage','countertop_drilling','equipment_location','network_connection','before','after','other'
  )),
  is_required     boolean not null default false,
  caption         text,
  geo_latitude    numeric(9,6),
  geo_longitude   numeric(9,6),
  taken_at        timestamptz not null default now(),
  uploaded_by     uuid references auth.users(id)
);

create index idx_ip_installation on public.installation_photos(installation_id);

-- =============================================================================
-- installation_signatures
-- =============================================================================
create table public.installation_signatures (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  signer_role     text not null check (signer_role in ('customer','installer','witness')),
  signer_name     text not null,
  signer_tax_id   text,
  signature_image_path text not null,
  context         text check (context in ('previous_damage','countertop_drilling','work_report')),
  signed_at       timestamptz not null default now(),
  ip_address      inet,
  user_agent      text
);

create index idx_is_installation on public.installation_signatures(installation_id);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.installations enable row level security;
alter table public.installations force row level security;

drop policy if exists inst_super on public.installations;
create policy inst_super on public.installations for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

-- SELECT: nivel 1 ve todo, dpto técnico ve dpto, instalador ve solo asignadas no completadas
drop policy if exists inst_select_by_scope on public.installations;
create policy inst_select_by_scope on public.installations
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('installations','view','all_company')
      or (app.can('installations','view','department') and app.in_department('tech'))
      or (
        app.can('installations','view','own')
        and installer_user_id = auth.uid()
        -- Decisión 1.7: instalador ve mientras no esté completada
        -- (al completarse pierde acceso a la ficha activa pero queda installer_user_id como autoría)
        and status not in ('completed','cancelled')
      )
      -- O si es comercial responsable (asignado al cliente/contrato)
      or (app.can('installations','view','department') and app.in_department('sales')
          and exists (
            select 1 from public.contracts c
            where c.id = installations.contract_id
              and (c.created_by = auth.uid() or c.company_id = app.current_company_id())
          ))
    )
  );

drop policy if exists inst_insert on public.installations;
create policy inst_insert on public.installations
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      app.can('installations','create','all_company')
      or (app.can('installations','create','department') and app.in_department('tech'))
    )
  );

drop policy if exists inst_update on public.installations;
create policy inst_update on public.installations
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('installations','update','all_company')
      or (app.can('installations','update','department') and app.in_department('tech'))
      or (app.can('installations','update','own') and installer_user_id = auth.uid())
    )
  )
  with check (company_id = app.current_company_id());

-- Tablas hijas (heredan)
do $$
declare t text;
begin
  for t in select unnest(array[
    'installation_items','installation_steps_log','installation_photos','installation_signatures'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_inherit_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id() and exists (select 1 from public.installations i where i.id = %I.installation_id and i.company_id = app.current_company_id() and i.deleted_at is null))', t || '_inherit_select', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_inherit_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id = app.current_company_id())', t || '_inherit_insert', t);
  end loop;
end $$;
