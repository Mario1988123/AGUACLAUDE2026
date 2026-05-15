-- =============================================================================
-- 20260525100000_time_punch_requests.sql
-- Tabla para que los empleados soliciten un fichaje manual:
--   - olvido de fichar entrada / salida
--   - corrección de un fichaje (ej. hora incorrecta)
--   - añadir fichaje retroactivo si la app falló
--
-- El admin aprueba/rechaza. Al aprobar se inserta time_punches con
-- is_manual=true y edited_by_admin = quien aprobó.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'punch_request_status') then
    create type app.punch_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
  end if;
end $$;

create table if not exists public.time_punch_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- Fichaje solicitado
  requested_at    timestamptz not null,
  punch_kind      text not null check (
    punch_kind in ('clock_in', 'clock_out', 'break_start', 'break_end')
  ),
  reason          text,
  -- Estado
  status          app.punch_request_status not null default 'pending',
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  review_notes    text,
  -- Si se aprueba, FK al time_punches creado (para deshacer si hace falta)
  resulting_punch_id uuid references public.time_punches(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_tpr_company_status
  on public.time_punch_requests(company_id, status, created_at desc);
create index if not exists idx_tpr_user
  on public.time_punch_requests(user_id, created_at desc);

create trigger trg_tpr_updated
  before update on public.time_punch_requests
  for each row execute function app.set_updated_at();

comment on table public.time_punch_requests is
  'Solicitudes de fichaje manual (olvidos / correcciones). Admin aprueba o rechaza.';

-- RLS
alter table public.time_punch_requests enable row level security;

-- Empleado: ve y crea sus propias solicitudes
drop policy if exists tpr_self_select on public.time_punch_requests;
create policy tpr_self_select on public.time_punch_requests
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists tpr_self_insert on public.time_punch_requests;
create policy tpr_self_insert on public.time_punch_requests
  for insert to authenticated
  with check (user_id = auth.uid() and company_id = app.current_company_id());

drop policy if exists tpr_self_cancel on public.time_punch_requests;
create policy tpr_self_cancel on public.time_punch_requests
  for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (status in ('pending', 'cancelled'));

-- Admin / directores: ven y resuelven todas las de su empresa
drop policy if exists tpr_admin_all on public.time_punch_requests;
create policy tpr_admin_all on public.time_punch_requests
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in (
           'company_admin','commercial_director','technical_director','telemarketing_director'
         )
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

drop policy if exists tpr_super on public.time_punch_requests;
create policy tpr_super on public.time_punch_requests
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

notify pgrst, 'reload schema';
