-- =============================================================================
-- 20260503230000_user_module_overrides.sql
-- Override de acceso a módulos por usuario. Por defecto cada rol tiene sus
-- módulos (definidos en seeds y en MODULES). Esta tabla permite al admin
-- conceder o denegar acceso a un módulo concreto a un usuario concreto.
-- =============================================================================

create table if not exists public.user_module_overrides (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  /** true = forzar acceso, false = forzar denegado */
  granted    boolean not null,
  set_by     uuid references auth.users(id),
  set_at     timestamptz not null default now(),
  primary key (user_id, company_id, module_key)
);

create index if not exists idx_user_module_overrides_user
  on public.user_module_overrides(user_id, company_id);

comment on table public.user_module_overrides is
  'Excepciones por usuario al acceso de módulos definido por sus roles.';
