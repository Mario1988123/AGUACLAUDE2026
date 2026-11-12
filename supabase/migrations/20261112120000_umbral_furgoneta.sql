-- Umbral del ámbar en "Mi furgoneta" (plan de permisos de técnicos, A2, 2026-11-12).
-- El técnico ve un punto ámbar («queda poco») cuando en su furgoneta quedan
-- <= umbral_furgoneta unidades de este producto. Null = 1 (la última unidad).
-- Si la furgoneta tiene umbral propio en warehouse_stock_thresholds.stock_min,
-- manda ese. Solo lo edita nivel 1/2 desde la ficha de producto (admin client).
-- Aditiva: el código funciona sin ella (umbral por defecto).
alter table public.products
  add column if not exists umbral_furgoneta integer null;

alter table public.products
  drop constraint if exists products_umbral_furgoneta_check;
alter table public.products
  add constraint products_umbral_furgoneta_check
  check (umbral_furgoneta is null or umbral_furgoneta >= 0);

comment on column public.products.umbral_furgoneta is
  'Mi furgoneta: ámbar cuando queden <= N unidades. Null = 1.';
