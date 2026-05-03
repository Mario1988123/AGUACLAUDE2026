-- =============================================================================
-- 20260503330000_product_datasheet.sql
-- Soporte para ficha técnica de producto:
--   - image_url en products (foto principal)
--   - include_in_datasheet en product_attributes (toggle por atributo)
--   - units_catalog: tabla maestra de unidades (L/min, bar, kg…) editable
--     por empresa + un set por defecto sembrado para todas.
-- =============================================================================

-- 1) Foto del producto: ya existe como main_image_url desde la migración
--    inicial 20260501121100_products.sql. No tocamos nada.

-- 2) Toggle "incluir en ficha técnica" por atributo del producto
alter table public.product_attributes
  add column if not exists include_in_datasheet boolean not null default true;

-- 3) Catálogo de unidades por empresa (el admin puede añadir las suyas, y
--    los seleccionables del datalist incluyen siempre los globales).
create table if not exists public.units_catalog (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,  -- null = global
  code        text not null,            -- "L/min", "bar", "kg", "ppm"
  label       text not null,            -- "Litros por minuto"
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_units_company on public.units_catalog(company_id, sort_order);

-- Sembrar unidades globales habituales si la tabla está vacía
insert into public.units_catalog (company_id, code, label, sort_order)
select null, code, label, sort_order from (values
  ('L/min',  'Litros por minuto',     10),
  ('L/h',    'Litros por hora',       20),
  ('m³/h',   'Metros cúbicos hora',   30),
  ('bar',    'Bar',                   40),
  ('kg',     'Kilogramos',            50),
  ('g',      'Gramos',                60),
  ('mm',     'Milímetros',            70),
  ('cm',     'Centímetros',           80),
  ('m',      'Metros',                90),
  ('°C',     'Grados Celsius',        100),
  ('ppm',    'Partes por millón',     110),
  ('mg/L',   'Miligramos por litro',  120),
  ('µm',     'Micras',                130),
  ('%',      'Porcentaje',            140),
  ('W',      'Vatios',                150),
  ('V',      'Voltios',               160),
  ('A',      'Amperios',              170),
  ('Hz',     'Hercios',               180),
  ('h',      'Horas',                 190),
  ('mes',    'Meses',                 200),
  ('año',    'Años',                  210),
  ('ud',     'Unidades',              220)
) as defaults(code, label, sort_order)
where not exists (select 1 from public.units_catalog);

-- RLS
alter table public.units_catalog enable row level security;

drop policy if exists units_select on public.units_catalog;
create policy units_select on public.units_catalog
  for select to authenticated
  using (company_id is null or company_id = app.current_company_id());

drop policy if exists units_admin_manage on public.units_catalog;
create policy units_admin_manage on public.units_catalog
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

drop policy if exists units_super on public.units_catalog;
create policy units_super on public.units_catalog
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
