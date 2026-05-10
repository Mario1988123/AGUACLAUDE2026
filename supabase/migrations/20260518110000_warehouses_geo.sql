-- =============================================================================
-- 20260518110000_warehouses_geo.sql
-- Dirección + coordenadas en warehouses, para usar como punto de partida en
-- las rutas (almacén → primer cliente). Antes solo había `address_id` que
-- enlazaba a addresses (que requieren lead_id o customer_id), inviable para
-- almacenes. Aquí guardamos los campos directamente.
-- =============================================================================

alter table public.warehouses
  add column if not exists address_street     text,
  add column if not exists address_postal_code text,
  add column if not exists address_city       text,
  add column if not exists address_province   text,
  add column if not exists latitude           numeric(9,6),
  add column if not exists longitude          numeric(9,6),
  add column if not exists geo_source         text check (geo_source in ('user_pin','user_location','geocoded','none'));

create index if not exists idx_warehouses_geo
  on public.warehouses(company_id, latitude, longitude)
  where latitude is not null and longitude is not null;

notify pgrst, 'reload schema';
