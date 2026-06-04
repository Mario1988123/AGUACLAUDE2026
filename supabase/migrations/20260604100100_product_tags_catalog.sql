-- =============================================================================
-- 20260604100100_product_tags_catalog.sql
-- Fase 1 del Plan Productos v2.
-- Catálogo opcional de tags por empresa para autocompletado y coherencia.
-- La empresa puede escribir tags libres directamente en `products.tags`
-- (text[]); este catálogo es solo para sugerir y dar color consistente
-- en el listado.
-- =============================================================================

create table if not exists public.product_tags_catalog (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,                              -- ej. "promo-junio", "bestseller", "horeca"
  color_hex       text not null default '#4880FF',
  description     text,
  display_order   integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  unique (company_id, name)
);

create index if not exists idx_ptc_company on public.product_tags_catalog(company_id) where is_active = true;

alter table public.product_tags_catalog enable row level security;
alter table public.product_tags_catalog force row level security;

drop policy if exists ptc_super on public.product_tags_catalog;
create policy ptc_super on public.product_tags_catalog
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Nivel 1, 2 y 3 leen los tags (necesario para que la UI los pinte con color
-- al renderizar la tabla y los filtros).
drop policy if exists ptc_select_tenant on public.product_tags_catalog;
create policy ptc_select_tenant on public.product_tags_catalog
  for select to authenticated using (company_id = app.current_company_id());

-- Solo admin (nivel 1) gestiona el catálogo de tags (crear/editar/borrar).
drop policy if exists ptc_admin_manage on public.product_tags_catalog;
create policy ptc_admin_manage on public.product_tags_catalog
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

comment on table public.product_tags_catalog is
  'Catálogo opcional de tags por empresa (sugerencias + color). products.tags acepta tags libres aunque no estén aquí.';

notify pgrst, 'reload schema';
