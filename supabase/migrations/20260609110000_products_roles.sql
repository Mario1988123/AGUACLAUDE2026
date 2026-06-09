-- =============================================================================
-- 20260609110000_products_roles.sql
-- Plan FIX Productos (2026-06-09) · Fase B1.
--
-- Un producto puede jugar VARIOS papeles a la vez sin duplicarse:
--   - sellable_standalone : se vende suelto (catálogo / propuestas)
--   - configurator_extra   : se ofrece como extra en el configurador (ej. grifería de una ósmosis)
--   - spare_part_role      : funciona también como recambio de equipos
--   - accessory_role       : es un accesorio
--
-- `products.kind` sigue siendo el papel PRINCIPAL. `roles` son papeles
-- ADICIONALES. ADITIVA: solo añade columna. Backfill conservador que NO cambia
-- el comportamiento actual (hoy nada filtra por roles).
-- =============================================================================

-- Valor por defecto = vendible suelto: así los productos EXISTENTES (Postgres
-- rellena las filas actuales con este default al añadir la columna) y los NUEVOS
-- mantienen el comportamiento de hoy (aparecen en catálogo/propuestas). El admin
-- puede desmarcarlo. ADITIVA y conservadora.
alter table public.products
  add column if not exists roles text[] not null default array['sellable_standalone']::text[];

-- Índice GIN para poder filtrar "productos que tengan el rol X" de forma rápida.
create index if not exists idx_products_roles on public.products using gin (roles)
  where deleted_at is null;

comment on column public.products.roles is
  'Papeles ADICIONALES del producto (además de kind): sellable_standalone, configurator_extra, spare_part_role, accessory_role.';

notify pgrst, 'reload schema';
