-- =============================================================================
-- 20260525140000_vacation_windows.sql
-- Ventanas vacacionales que el admin define: rangos de fechas en los que
-- el empleado PUEDE pedir vacaciones de más de 2 días seguidos. Fuera de
-- ventana solo se permite ≤2 días sueltos.
--
-- Opcional: tope de personas concurrentes ("máx 2 personas a la vez").
-- =============================================================================

create table if not exists public.vacation_windows (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  year                   integer not null,
  starts_on              date not null,
  ends_on                date not null,
  label                  text not null,
  /** Máximo de empleados a la vez con vacaciones aprobadas en esta
   *  ventana. NULL = sin tope. */
  max_concurrent_users   integer,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (max_concurrent_users is null or max_concurrent_users > 0)
);

create index if not exists idx_vw_company_year
  on public.vacation_windows(company_id, year);
create index if not exists idx_vw_dates
  on public.vacation_windows(company_id, starts_on, ends_on);

create trigger trg_vw_updated
  before update on public.vacation_windows
  for each row execute function app.set_updated_at();

comment on table public.vacation_windows is
  'Ventanas en las que el empleado puede pedir vacaciones de >2 días. Admin las crea cada año.';

-- RLS
alter table public.vacation_windows enable row level security;

drop policy if exists vw_super on public.vacation_windows;
create policy vw_super on public.vacation_windows
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Todos los empleados pueden VER las ventanas de su empresa
drop policy if exists vw_select on public.vacation_windows;
create policy vw_select on public.vacation_windows
  for select to authenticated
  using (company_id = app.current_company_id());

-- Solo admin / directores manage
drop policy if exists vw_admin_manage on public.vacation_windows;
create policy vw_admin_manage on public.vacation_windows
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

notify pgrst, 'reload schema';
