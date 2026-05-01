-- =============================================================================
-- 20260501120200_tenant_core_tables.sql
-- Capa 2 · Paso 2.3 · Tablas TENANT de Capa 1 (multi-tenancy + permisos).
-- Todas con company_id NOT NULL.
--
-- Tablas creadas:
--   - company_settings        configuración de empresa (1 fila por empresa)
--   - company_modules         módulos activos por empresa (toggle del superadmin)
--   - user_profiles           perfil del usuario dentro de empresa
--   - user_roles              asignación rol-usuario (M:N — multi-rol)
--   - team_assignments        jerarquía director -> operativo
--   - permission_overrides    excepciones puntuales de permisos por usuario
-- =============================================================================

-- -----------------------------------------------------------------------------
-- company_settings
-- -----------------------------------------------------------------------------
create table public.company_settings (
  company_id          uuid primary key references public.companies(id) on delete cascade,
  -- Horario comercial general
  business_hours      jsonb not null default
    '{"mon":{"open":"09:00","close":"18:00"},"tue":{"open":"09:00","close":"18:00"},"wed":{"open":"09:00","close":"18:00"},"thu":{"open":"09:00","close":"18:00"},"fri":{"open":"09:00","close":"18:00"},"sat":null,"sun":null}'::jsonb,
  -- Configuración de leads
  lead_expiry_days    integer not null default 30 check (lead_expiry_days > 0),
  -- Plantilla por defecto de propuestas (referencia a documento en storage)
  proposal_template_id uuid,
  -- Color base para PDFs
  pdf_brand_color     text default '#2563eb',
  -- Geolocalización tolerada en metros (incidencia si supera)
  installation_geo_tolerance_m  integer not null default 300 check (installation_geo_tolerance_m > 0),
  -- Margen ± minutos para iniciar parte de instalación
  installation_time_tolerance_min integer not null default 60,
  -- Otras settings flexibles
  extra               jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_company_settings_updated
  before update on public.company_settings
  for each row execute function app.set_updated_at();

comment on table public.company_settings is
  'Configuración general de la empresa. Una fila por empresa.';

-- -----------------------------------------------------------------------------
-- company_modules
-- -----------------------------------------------------------------------------
create table public.company_modules (
  company_id   uuid not null references public.companies(id) on delete cascade,
  module_key   text not null references public.modules_catalog(key) on delete cascade,
  is_active    boolean not null default true,
  settings     jsonb not null default '{}'::jsonb,
  activated_at timestamptz not null default now(),
  primary key (company_id, module_key)
);

create index idx_company_modules_company on public.company_modules(company_id);

comment on table public.company_modules is
  'Módulos activos por empresa. El superadmin controla toggle. Settings JSON específico del módulo.';

-- -----------------------------------------------------------------------------
-- user_profiles
-- -----------------------------------------------------------------------------
create table public.user_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete cascade,
  full_name      text not null,
  display_name   text,
  avatar_url     text,
  phone          text,
  status         app.user_status not null default 'invited',
  must_change_password boolean not null default true,
  -- Datos opcionales
  job_title      text,
  notes          text,
  -- Auditoría
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  invited_at     timestamptz,
  activated_at   timestamptz,
  last_login_at  timestamptz
);

create index idx_user_profiles_company on public.user_profiles(company_id);
create index idx_user_profiles_status on public.user_profiles(company_id, status);

create trigger trg_user_profiles_updated
  before update on public.user_profiles
  for each row execute function app.set_updated_at();

comment on table public.user_profiles is
  'Perfil del usuario dentro de su empresa. FK 1:1 con auth.users.';
comment on column public.user_profiles.must_change_password is
  'Si true, fuerza cambio de contraseña en el siguiente login.';

-- -----------------------------------------------------------------------------
-- user_roles  (M:N — un usuario puede tener varios roles, decisión 1.2)
-- -----------------------------------------------------------------------------
create table public.user_roles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  role_key      text not null references public.roles_catalog(key) on delete restrict,
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid references auth.users(id) on delete set null,
  revoked_at    timestamptz,
  unique (user_id, company_id, role_key)
);

create index idx_user_roles_user on public.user_roles(user_id) where revoked_at is null;
create index idx_user_roles_company on public.user_roles(company_id) where revoked_at is null;

-- Decisión 1.12: una empresa = UN admin. Constraint único parcial.
create unique index uniq_company_admin_per_company
  on public.user_roles (company_id)
  where role_key = 'company_admin' and revoked_at is null;

comment on table public.user_roles is
  'Asignación M:N user <-> role dentro de empresa. revoked_at marca histórico.';
comment on index public.uniq_company_admin_per_company is
  'Decisión 1.12: solo un company_admin activo por empresa.';

-- -----------------------------------------------------------------------------
-- team_assignments
-- -----------------------------------------------------------------------------
create table public.team_assignments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  manager_user_id  uuid not null references auth.users(id) on delete cascade,
  member_user_id   uuid not null references auth.users(id) on delete cascade,
  for_role_key     text not null references public.roles_catalog(key) on delete restrict,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  revoked_at       timestamptz,
  check (manager_user_id <> member_user_id),
  unique (company_id, manager_user_id, member_user_id, for_role_key)
);

create index idx_team_manager on public.team_assignments(manager_user_id) where revoked_at is null;
create index idx_team_member on public.team_assignments(member_user_id) where revoked_at is null;

comment on table public.team_assignments is
  'Jerarquía director -> operativo dentro del departamento. Un manager puede tener N members. for_role_key indica para qué rol del member aplica esta jerarquía (relevante en multi-rol).';

-- -----------------------------------------------------------------------------
-- permission_overrides
-- -----------------------------------------------------------------------------
create table public.permission_overrides (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  permission_id  uuid not null references public.permissions_catalog(id) on delete cascade,
  granted        boolean not null,                                  -- true = añade permiso, false = revoca
  reason         text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  expires_at     timestamptz,
  unique (company_id, user_id, permission_id)
);

create index idx_perm_overrides_user on public.permission_overrides(user_id);

comment on table public.permission_overrides is
  'Excepciones puntuales de permisos por usuario. Solo admin puede modificar. Use con moderación.';
