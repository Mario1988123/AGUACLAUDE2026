-- =============================================================================
-- 20260503260000_attribute_categories.sql
-- Tabla intermedia atributo↔categorías globales: un atributo puede aplicar
-- a varias categorías de producto (p. ej. "Capacidad" en Osmosis y Depósitos).
-- =============================================================================

create table if not exists public.global_attribute_categories (
  attribute_id uuid not null references public.global_attributes(id) on delete cascade,
  category_id  uuid not null references public.global_categories(id) on delete cascade,
  primary key (attribute_id, category_id)
);

create index if not exists idx_gac_category on public.global_attribute_categories(category_id);
