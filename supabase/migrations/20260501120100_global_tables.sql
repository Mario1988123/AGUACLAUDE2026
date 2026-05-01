-- =============================================================================
-- 20260501120100_global_tables.sql
-- Capa 2 · Paso 2.2 · Tablas GLOBALES (sin company_id).
-- Propiedad del superadmin del SaaS.
--
-- Tablas creadas:
--   - companies              empresas tenant (clientes del SaaS)
--   - superadmins            usuarios con rol superadmin global
--   - modules_catalog        catálogo de módulos del CRM
--   - roles_catalog          catálogo de los 8 roles fijos
--   - permissions_catalog    catálogo (module, action, scope)
--   - role_permissions       asignación rol -> permisos + restricciones campo
--
-- RLS se aplica en migración separada (20260501120500_rls_policies.sql).
-- Seeds en 20260501120600_seeds.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- companies
-- -----------------------------------------------------------------------------
create table public.companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text not null unique,                          -- para URLs internas (no público)
  status              app.company_status not null default 'trial',
  max_users           integer not null default 5 check (max_users > 0),
  max_storage_mb      integer not null default 1024 check (max_storage_mb > 0),
  monthly_cost_cents  integer not null default 0 check (monthly_cost_cents >= 0),
  billing_email       text,
  fiscal_data         jsonb not null default '{}'::jsonb,           -- razón social, CIF, dirección fiscal, etc.
  logo_url            text,
  primary_color       text default '#2563eb',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  activated_at        timestamptz,
  cancelled_at        timestamptz
);

create index idx_companies_status on public.companies(status);
create index idx_companies_slug on public.companies(slug);

create trigger trg_companies_updated
  before update on public.companies
  for each row execute function app.set_updated_at();

comment on table public.companies is
  'Empresas tenant del SaaS. Cada fila = un cliente del superadmin.';
comment on column public.companies.slug is
  'Identificador URL-safe único, ej. "osmofilter". No para uso público.';
comment on column public.companies.max_users is
  'Límite de usuarios totales en la empresa, configurado por el superadmin.';
comment on column public.companies.fiscal_data is
  'Datos fiscales completos de la empresa: razón social, CIF, dirección, IAE, etc. JSON.';

-- -----------------------------------------------------------------------------
-- superadmins
-- -----------------------------------------------------------------------------
create table public.superadmins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users(id) on delete set null,
  notes       text
);

comment on table public.superadmins is
  'Lista de auth.users con rol superadmin global del SaaS. Bypassa RLS de tablas tenant.';

-- -----------------------------------------------------------------------------
-- modules_catalog
-- -----------------------------------------------------------------------------
create table public.modules_catalog (
  key             text primary key,                                 -- "leads", "customers", ...
  label_es        text not null,
  description_es  text,
  icon            text,                                              -- nombre de icono Lucide
  default_active  boolean not null default true,
  is_core         boolean not null default false,                   -- si es true no se puede desactivar (auth, settings)
  is_parked       boolean not null default false,                   -- aparcado pero con BD prevista
  sort_order      integer not null default 0
);

create index idx_modules_catalog_sort on public.modules_catalog(sort_order);

comment on table public.modules_catalog is
  'Catálogo cerrado de módulos disponibles en el CRM. Seed inicial.';
comment on column public.modules_catalog.is_core is
  'Si true, el módulo no se puede desactivar por empresa (auth, settings).';

-- -----------------------------------------------------------------------------
-- roles_catalog
-- -----------------------------------------------------------------------------
create table public.roles_catalog (
  key                 text primary key,                              -- "company_admin", ...
  label_es            text not null,
  level               smallint not null check (level between 0 and 3),
  default_department  app.department_kind,                           -- null para admin
  description_es      text,
  is_global           boolean not null default false,                -- true solo para superadmin
  sort_order          integer not null default 0
);

comment on table public.roles_catalog is
  'Catálogo cerrado de los 8 roles fijos del sistema. Seed inicial.';
comment on column public.roles_catalog.level is
  '0=superadmin, 1=company_admin, 2=director, 3=operativo nivel 3.';

-- -----------------------------------------------------------------------------
-- permissions_catalog
-- -----------------------------------------------------------------------------
create table public.permissions_catalog (
  id          uuid primary key default gen_random_uuid(),
  module      text not null references public.modules_catalog(key) on delete cascade,
  action      app.permission_action not null,
  scope       app.permission_scope not null,
  description_es text,
  unique (module, action, scope)
);

create index idx_permissions_catalog_module on public.permissions_catalog(module);

comment on table public.permissions_catalog is
  'Catálogo de permisos atómicos (módulo × acción × scope). Seed inicial.';

-- -----------------------------------------------------------------------------
-- role_permissions
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  role_key            text not null references public.roles_catalog(key) on delete cascade,
  permission_id       uuid not null references public.permissions_catalog(id) on delete cascade,
  field_restrictions  jsonb not null default '{}'::jsonb,
  primary key (role_key, permission_id)
);

comment on table public.role_permissions is
  'Asignación M:N rol -> permiso. field_restrictions oculta campos por rol (ej. cost, margin, iban).';
comment on column public.role_permissions.field_restrictions is
  'JSON con estructura {"<modulo>": {"hidden_fields": ["cost", "margin"]}}.';
