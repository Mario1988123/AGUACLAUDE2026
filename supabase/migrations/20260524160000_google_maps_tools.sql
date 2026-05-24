-- =============================================================================
-- 20260524160000_google_maps_tools.sql
-- Módulo "Google Maps Tools" gateado por superadmin con tres modos:
--   · disabled   → como hasta ahora (sin tools premium, solo autocomplete
--                  básico si la empresa puso su clave en el bundle).
--   · shared_key → usa la clave de la plataforma (NEXT_PUBLIC_GOOGLE_MAPS_KEY
--                  + GOOGLE_MAPS_PLATFORM_SERVER_KEY en env). Anthropic-style
--                  paga Google y cobra a la empresa vía cuota. Cap mensual
--                  por empresa controla el riesgo.
--   · own_key    → la empresa configura su propia API key (cifrada AES-256-GCM
--                  con GMAPS_MASTER_KEY) y paga su factura directa a Google.
--                  El cap mensual sigue aplicando como freno preventivo.
-- =============================================================================

-- Tipo enum del modo
do $$ begin
  create type app.gmaps_mode as enum ('disabled', 'shared_key', 'own_key');
exception
  when duplicate_object then null;
end $$;

-- Toggle por empresa
alter table public.companies
  add column if not exists gmaps_mode app.gmaps_mode not null default 'disabled',
  -- Tope máximo de gasto mensual (USD) para esta empresa. Si nuestro
  -- contador agregado del mes supera este número, canUseGoogleMaps()
  -- devuelve false y caemos a OSM/Leaflet. Default $50/mes razonable.
  add column if not exists gmaps_monthly_cap_usd numeric(8,2) not null default 50,
  -- Cap diario para freno duro. Default $10.
  add column if not exists gmaps_daily_cap_usd numeric(8,2) not null default 10;

comment on column public.companies.gmaps_mode is
  'Modo de Google Maps Tools: disabled | shared_key (usa key plataforma, cap mensual) | own_key (empresa configura su key + paga).';

-- Config de la empresa: features activadas + key cifrada (modo own_key)
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
  add column if not exists gmaps_alert_email text;

comment on column public.company_settings.gmaps_features is
  'Toggles de features Google Maps. Geocoding+Autocomplete siempre activos si gmaps_mode != disabled.';
comment on column public.company_settings.gmaps_api_key_encrypted is
  'Solo para modo own_key. Cifrada AES-256-GCM con GMAPS_MASTER_KEY. Nunca se devuelve descifrada al cliente.';

-- Contador de uso. Una fila por llamada Google que hacemos. Sin tenant_id
-- en RLS porque el agregado por mes lo necesita superadmin también.
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
create index if not exists idx_gau_company_month
  on public.google_api_usage (company_id, date_trunc('month', called_at));
create index if not exists idx_gau_company_day
  on public.google_api_usage (company_id, date_trunc('day', called_at));

alter table public.google_api_usage enable row level security;

drop policy if exists gau_read_own_company on public.google_api_usage;
create policy gau_read_own_company
  on public.google_api_usage
  for select
  using (
    app.is_superadmin()
    or company_id = app.current_company_id()
  );

-- Solo el backend (admin client) inserta filas; bloqueamos write desde RLS.
drop policy if exists gau_insert_blocked on public.google_api_usage;
create policy gau_insert_blocked
  on public.google_api_usage
  for insert
  with check (false);

comment on table public.google_api_usage is
  'Contador propio de llamadas a Google Maps Platform. Una fila por llamada. cost_micro_usd en micro-USD (1$ = 1.000.000) para precisión sin floats.';

notify pgrst, 'reload schema';
