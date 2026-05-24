-- =============================================================================
-- 20260524180000_gmaps_fix_indexes.sql
-- Repara la migración 20260524160000_google_maps_tools.sql en entornos
-- donde abortó por "functions in index expression must be marked IMMUTABLE":
-- los índices `idx_gau_company_month` y `idx_gau_company_day` usaban
-- date_trunc(text, timestamptz), que es STABLE en lugar de IMMUTABLE.
-- Postgres aborta la TRANSACCIÓN COMPLETA cuando un statement falla, así
-- que en algunos entornos quedaron a medio aplicar tanto las columnas
-- gmaps_daily_cap_usd/monthly_cap_usd como la tabla google_api_usage.
--
-- Esta migración es idempotente: re-añade columnas con `if not exists`,
-- elimina los índices problemáticos si quedaron creados, y deja solo el
-- índice por (company_id, called_at desc) que sí es válido y cubre los
-- queries por rango de mes/día (gte sobre called_at).
-- =============================================================================

-- Eliminar índices funcionales problemáticos si llegaron a crearse
drop index if exists public.idx_gau_company_month;
drop index if exists public.idx_gau_company_day;

-- Re-aplicar columnas de companies (idempotente)
alter table public.companies
  add column if not exists gmaps_mode app.gmaps_mode not null default 'disabled',
  add column if not exists gmaps_monthly_cap_usd numeric(8,2) not null default 50,
  add column if not exists gmaps_daily_cap_usd numeric(8,2) not null default 10;

-- Re-aplicar columnas de company_settings (idempotente)
alter table public.company_settings
  add column if not exists gmaps_features jsonb not null default '{
    "interactive_maps": false,
    "smart_routes": false,
    "directions": false,
    "static_pdfs": false,
    "street_view": false,
    "anti_fraud_roads": false
  }'::jsonb,
  add column if not exists gmaps_api_key_encrypted text,
  add column if not exists gmaps_api_key_set_at timestamptz,
  add column if not exists gmaps_alert_email text,
  add column if not exists gmaps_alert_last_sent_day date;

-- Re-crear tabla google_api_usage si no existe
create table if not exists public.google_api_usage (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  api               text not null,
  endpoint          text,
  units             int not null default 1,
  cost_micro_usd    bigint not null,
  called_by_user_id uuid references auth.users(id) on delete set null,
  success           boolean not null default true,
  error_code        text,
  called_at         timestamptz not null default now()
);

create index if not exists idx_gau_company_called_at
  on public.google_api_usage (company_id, called_at desc);

alter table public.google_api_usage enable row level security;

drop policy if exists gau_read_own_company on public.google_api_usage;
create policy gau_read_own_company
  on public.google_api_usage
  for select
  using (
    app.is_superadmin()
    or company_id = app.current_company_id()
  );

drop policy if exists gau_insert_blocked on public.google_api_usage;
create policy gau_insert_blocked
  on public.google_api_usage
  for insert
  with check (false);

-- Forzar recarga del schema cache de PostgREST
notify pgrst, 'reload schema';
