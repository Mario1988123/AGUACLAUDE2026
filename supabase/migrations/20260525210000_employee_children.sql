-- =============================================================================
-- 20260525210000_employee_children.sql
-- Hijos del empleado para validar permiso parental hasta los 8 años.
--
-- Solo se almacena fecha de nacimiento y nombre opcional. Sin datos
-- sensibles más allá de eso (no DNI, no escolarización...).
-- El empleado puede añadir/editar; admin/director también para gestión.
-- =============================================================================

create table if not exists public.employee_children (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  child_name      text,
  birth_date      date not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_emp_children_user on public.employee_children(user_id);
create index if not exists idx_emp_children_company on public.employee_children(company_id);

create trigger trg_emp_children_updated
  before update on public.employee_children
  for each row execute function app.set_updated_at();

comment on table public.employee_children is
  'Hijos del empleado para validar permisos parentales (8 años, maternidad, etc.). El empleado los gestiona.';

alter table public.employee_children enable row level security;

drop policy if exists ec_super on public.employee_children;
create policy ec_super on public.employee_children
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Empleado gestiona los suyos
drop policy if exists ec_self_select on public.employee_children;
create policy ec_self_select on public.employee_children
  for select to authenticated using (user_id = auth.uid());
drop policy if exists ec_self_insert on public.employee_children;
create policy ec_self_insert on public.employee_children
  for insert to authenticated with check (
    user_id = auth.uid() and company_id = app.current_company_id()
  );
drop policy if exists ec_self_update on public.employee_children;
create policy ec_self_update on public.employee_children
  for update to authenticated using (user_id = auth.uid());
drop policy if exists ec_self_delete on public.employee_children;
create policy ec_self_delete on public.employee_children
  for delete to authenticated using (user_id = auth.uid());

-- Admin/director también gestiona para la empresa
drop policy if exists ec_admin on public.employee_children;
create policy ec_admin on public.employee_children
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','commercial_director','technical_director','telemarketing_director')
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

notify pgrst, 'reload schema';
