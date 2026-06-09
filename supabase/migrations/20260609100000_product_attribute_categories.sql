-- =============================================================================
-- 20260609100000_product_attribute_categories.sql
-- Plan FIX Productos (2026-06-09) · Fase A3.
--
-- Permite que UN atributo aplique a VARIAS categorías, sin tocar el modelo
-- actual. `product_attributes.category_id` se mantiene como "categoría
-- principal"; esta tabla puente añade las categorías EXTRA.
--
-- ADITIVA: solo crea una tabla nueva. No borra ni modifica nada existente.
-- =============================================================================

create table if not exists public.product_attribute_categories (
  attribute_id  uuid not null references public.product_attributes(id) on delete cascade,
  category_id   uuid not null references public.product_categories(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (attribute_id, category_id)
);

create index if not exists idx_pac_attribute on public.product_attribute_categories(attribute_id);
create index if not exists idx_pac_category on public.product_attribute_categories(category_id);
create index if not exists idx_pac_company on public.product_attribute_categories(company_id);

comment on table public.product_attribute_categories is
  'Categorías EXTRA de un atributo (un atributo en varias categorías). La categoría principal sigue en product_attributes.category_id.';

-- RLS: mismas reglas que el resto del módulo Productos.
alter table public.product_attribute_categories enable row level security;
alter table public.product_attribute_categories force row level security;

drop policy if exists pac_super on public.product_attribute_categories;
create policy pac_super on public.product_attribute_categories for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists pac_select_tenant on public.product_attribute_categories;
create policy pac_select_tenant on public.product_attribute_categories for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists pac_admin_manage on public.product_attribute_categories;
create policy pac_admin_manage on public.product_attribute_categories for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

notify pgrst, 'reload schema';
