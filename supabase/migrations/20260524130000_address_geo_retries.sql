-- =============================================================================
-- 20260524130000_address_geo_retries.sql
-- Columna geo_retries para que processGeocodeBacklog no reintente
-- indefinidamente direcciones que Nominatim no sabe resolver.
-- Tras 3 intentos fallidos la marcamos como geo_source='none' y
-- queda fuera del bucle.
-- =============================================================================

alter table public.addresses
  add column if not exists geo_retries smallint not null default 0;

create index if not exists idx_addresses_geo_backlog
  on public.addresses (created_at)
  where latitude is null and longitude is null and geo_retries < 3;

comment on column public.addresses.geo_retries is
  'Nº de intentos automáticos de geocoding fallidos. processGeocodeBacklog cron deja de reintentar cuando llega a 3 y marca geo_source=none.';

notify pgrst, 'reload schema';
