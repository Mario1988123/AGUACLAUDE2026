-- =============================================================================
-- 20260501120500_rls_policies.sql
-- Capa 2 · Paso 2.6 · RLS y políticas para tablas globales y tenant Capa 1.
--
-- Patrón:
--   - Habilitar RLS.
--   - Policy "<tabla>_superadmin_all": superadmin lo ve y modifica todo.
--   - Policy "<tabla>_tenant_*" según corresponda (select/insert/update/delete).
--
-- IMPORTANTE: ninguna tabla queda sin RLS.
-- =============================================================================

-- ===========================================================================
-- GLOBALES
-- ===========================================================================

-- companies: solo superadmin gestiona; cada empresa lee SU fila
alter table public.companies enable row level security;
alter table public.companies force row level security;

drop policy if exists companies_superadmin_all on public.companies;
create policy companies_superadmin_all on public.companies
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

drop policy if exists companies_tenant_read_self on public.companies;
create policy companies_tenant_read_self on public.companies
  for select to authenticated
  using (id = app.current_company_id());

-- superadmins: solo superadmins
alter table public.superadmins enable row level security;
alter table public.superadmins force row level security;

drop policy if exists superadmins_superadmin_all on public.superadmins;
create policy superadmins_superadmin_all on public.superadmins
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

-- modules_catalog: lectura abierta a usuarios autenticados, escritura solo superadmin
alter table public.modules_catalog enable row level security;

drop policy if exists modules_catalog_read_authenticated on public.modules_catalog;
create policy modules_catalog_read_authenticated on public.modules_catalog
  for select to authenticated using (true);

drop policy if exists modules_catalog_write_superadmin on public.modules_catalog;
create policy modules_catalog_write_superadmin on public.modules_catalog
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

-- roles_catalog: lectura abierta, escritura superadmin
alter table public.roles_catalog enable row level security;

drop policy if exists roles_catalog_read_authenticated on public.roles_catalog;
create policy roles_catalog_read_authenticated on public.roles_catalog
  for select to authenticated using (true);

drop policy if exists roles_catalog_write_superadmin on public.roles_catalog;
create policy roles_catalog_write_superadmin on public.roles_catalog
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

-- permissions_catalog: lectura authenticated, escritura superadmin
alter table public.permissions_catalog enable row level security;

drop policy if exists permissions_catalog_read on public.permissions_catalog;
create policy permissions_catalog_read on public.permissions_catalog
  for select to authenticated using (true);

drop policy if exists permissions_catalog_write_superadmin on public.permissions_catalog;
create policy permissions_catalog_write_superadmin on public.permissions_catalog
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

-- role_permissions: lectura authenticated, escritura superadmin
alter table public.role_permissions enable row level security;

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions
  for select to authenticated using (true);

drop policy if exists role_permissions_write_superadmin on public.role_permissions;
create policy role_permissions_write_superadmin on public.role_permissions
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

-- ===========================================================================
-- TENANT CAPA 1
-- ===========================================================================

-- company_settings
alter table public.company_settings enable row level security;
alter table public.company_settings force row level security;

drop policy if exists company_settings_super on public.company_settings;
create policy company_settings_super on public.company_settings
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists company_settings_read_tenant on public.company_settings;
create policy company_settings_read_tenant on public.company_settings
  for select to authenticated
  using (company_id = app.current_company_id());

-- Solo admin puede modificar settings (decisión 1.11)
drop policy if exists company_settings_write_admin on public.company_settings;
create policy company_settings_write_admin on public.company_settings
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  )
  with check (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

drop policy if exists company_settings_insert_admin on public.company_settings;
create policy company_settings_insert_admin on public.company_settings
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

-- company_modules
alter table public.company_modules enable row level security;
alter table public.company_modules force row level security;

drop policy if exists company_modules_super on public.company_modules;
create policy company_modules_super on public.company_modules
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists company_modules_read_tenant on public.company_modules;
create policy company_modules_read_tenant on public.company_modules
  for select to authenticated
  using (company_id = app.current_company_id());

-- Activar/desactivar módulos solo superadmin (ya cubierto por _super); admin
-- de empresa puede leer pero NO modificar los toggles.

-- user_profiles
alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;

drop policy if exists user_profiles_super on public.user_profiles;
create policy user_profiles_super on public.user_profiles
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists user_profiles_read_tenant on public.user_profiles;
create policy user_profiles_read_tenant on public.user_profiles
  for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_profiles_admin_manage on public.user_profiles;
create policy user_profiles_admin_manage on public.user_profiles
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  )
  with check (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

-- user_roles
alter table public.user_roles enable row level security;
alter table public.user_roles force row level security;

drop policy if exists user_roles_super on public.user_roles;
create policy user_roles_super on public.user_roles
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists user_roles_read_tenant on public.user_roles;
create policy user_roles_read_tenant on public.user_roles
  for select to authenticated
  using (company_id = app.current_company_id());

-- Solo admin puede asignar/revocar roles
drop policy if exists user_roles_admin_manage on public.user_roles;
create policy user_roles_admin_manage on public.user_roles
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  )
  with check (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

-- team_assignments
alter table public.team_assignments enable row level security;
alter table public.team_assignments force row level security;

drop policy if exists team_assignments_super on public.team_assignments;
create policy team_assignments_super on public.team_assignments
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists team_assignments_read_tenant on public.team_assignments;
create policy team_assignments_read_tenant on public.team_assignments
  for select to authenticated
  using (company_id = app.current_company_id());

-- Admin + directores pueden gestionar asignaciones de su equipo
-- (las policies de directores se afinarán cuando lleguemos a módulos negocio)
drop policy if exists team_assignments_admin_manage on public.team_assignments;
create policy team_assignments_admin_manage on public.team_assignments
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  )
  with check (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

-- permission_overrides
alter table public.permission_overrides enable row level security;
alter table public.permission_overrides force row level security;

drop policy if exists permission_overrides_super on public.permission_overrides;
create policy permission_overrides_super on public.permission_overrides
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists permission_overrides_read_self on public.permission_overrides;
create policy permission_overrides_read_self on public.permission_overrides
  for select to authenticated
  using (user_id = auth.uid() or app.has_role('company_admin'));

drop policy if exists permission_overrides_admin_manage on public.permission_overrides;
create policy permission_overrides_admin_manage on public.permission_overrides
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  )
  with check (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

-- ===========================================================================
-- Revoke directos sobre tablas para que solo se acceda vía RLS
-- ===========================================================================
-- (Supabase ya hace esto por defecto para anon; mantener por si acaso.)
revoke all on all tables in schema public from anon;
grant select on public.modules_catalog, public.roles_catalog, public.permissions_catalog
  to anon;  -- catálogos públicos para login screen / branding
