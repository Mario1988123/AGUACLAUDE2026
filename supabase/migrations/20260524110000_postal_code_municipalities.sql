-- =============================================================================
-- 20260524110000_postal_code_municipalities.sql
-- Catálogo opcional CP↔municipio para autocompletar direcciones en
-- AddressForm (combobox bidireccional).
--
-- Diseño:
--   · Datos de referencia (no tenant-specific): no lleva company_id.
--   · Por defecto se crea vacía. Las acciones lookupMunicipalitiesByPostalCode
--     y lookupPostalCodesByMunicipality caen a OSM Nominatim si no hay nada
--     local. Si una empresa quiere autocompletado offline + más rápido +
--     consistente, puede cargar el CSV INE / geoapi.es con un COPY.
--   · Múltiples filas por CP son válidas: en CPs metropolitanos un mismo
--     código puede tener varios municipios/distritos.
-- =============================================================================

create table if not exists public.postal_code_municipalities (
  postal_code  text not null check (postal_code ~ '^\d{5}$'),
  municipality text not null,
  province     text not null,
  -- Código de provincia ISO 01..52 (Madrid=28, Barcelona=08, etc.).
  province_code text,
  primary key (postal_code, municipality)
);

create index if not exists idx_pcm_postal_code
  on public.postal_code_municipalities (postal_code);
create index if not exists idx_pcm_municipality
  on public.postal_code_municipalities (lower(municipality));
create index if not exists idx_pcm_province
  on public.postal_code_municipalities (lower(province));

comment on table public.postal_code_municipalities is
  'Catálogo CP↔municipio para autocompletar AddressForm. Datos de referencia (no tenant). Por defecto vacía; las server actions caen a Nominatim. Para cargar dataset completo: COPY desde CSV INE/geoapi.es.';

-- RLS: lectura pública (datos de referencia), escritura solo superadmin.
alter table public.postal_code_municipalities enable row level security;

drop policy if exists pcm_read_all on public.postal_code_municipalities;
create policy pcm_read_all
  on public.postal_code_municipalities
  for select
  using (true);

drop policy if exists pcm_write_superadmin on public.postal_code_municipalities;
create policy pcm_write_superadmin
  on public.postal_code_municipalities
  for all
  using (app.is_superadmin())
  with check (app.is_superadmin());

notify pgrst, 'reload schema';
