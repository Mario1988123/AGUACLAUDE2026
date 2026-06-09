-- =============================================================================
-- 20260609120000_product_filters_catalog.sql
-- Plan FIX Productos (2026-06-09) · Fase C.
--
-- Un filtro/recambio sigue siendo recambio de equipos, pero ahora puede además
-- venderse suelto / mostrarse en catálogo. Ya tenía `sale_price_cents`; añadimos
-- el flag para sacarlo al catálogo y una categoría opcional para agruparlo.
--
-- ADITIVA: solo añade columnas. No borra ni cambia nada.
-- =============================================================================

alter table public.product_filters
  add column if not exists show_in_catalog boolean not null default false;

alter table public.product_filters
  add column if not exists category_id uuid references public.product_categories(id) on delete set null;

create index if not exists idx_pf_catalog on public.product_filters(company_id)
  where show_in_catalog = true and deleted_at is null;

comment on column public.product_filters.show_in_catalog is
  'Si true, el filtro/recambio puede venderse suelto y aparecer en catálogo (además de ser recambio).';

notify pgrst, 'reload schema';
