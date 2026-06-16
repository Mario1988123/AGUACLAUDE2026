-- =============================================================================
-- 20260617100000_master_catalog.sql
-- Catálogo MAESTRO por fabricantes (superadmin). Separado del catálogo de cada
-- empresa para que NUNCA choquen: estas tablas son globales (sin company_id) y
-- solo las gestiona el superadmin. Las empresas no las navegan; cuando dan de
-- alta un producto y teclean la REFERENCIA DEL PROVEEDOR, una server action con
-- service-role busca aquí por esa referencia y, si existe, autocompleta su copia.
--
-- Puente empresa <-> maestro: products.catalog_product_id + supplier_reference
-- (bloqueada en la empresa). Avisos de actualización: catalog_products.version
-- sube en cada cambio; si products.catalog_version_synced < version => "hay
-- actualización disponible" (la empresa la aplica o la descarta, nunca se pisa).
--
-- Tablas:
--   - manufacturers                 fabricantes (ficha + logo)
--   - catalog_products              productos maestros (SIN precio ni stock)
--   - catalog_product_attributes    valores de atributos (atributos GLOBALES)
--   - catalog_product_documents     documentación del fabricante (bucket global)
--   - catalog_product_photos        fotos del producto maestro (bucket global)
--   + columnas de enganche en products
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fabricantes
-- -----------------------------------------------------------------------------
create table if not exists public.manufacturers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  logo_path   text,                                   -- bucket "catalog-global"
  website     text,
  notes       text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

create unique index if not exists uniq_manufacturers_name
  on public.manufacturers (lower(name));

-- -----------------------------------------------------------------------------
-- Productos maestros (SIN precio ni stock)
-- -----------------------------------------------------------------------------
create table if not exists public.catalog_products (
  id                   uuid primary key default gen_random_uuid(),
  manufacturer_id      uuid references public.manufacturers(id) on delete set null,
  supplier_reference   text not null,                 -- LLAVE única (ref del proveedor)
  name                 text not null,
  kind                 app.product_kind not null default 'equipment',
  category_global_key  text references public.product_categories_global(key) on delete set null,
  short_description    text,
  long_description     text,
  dim_width_mm         integer check (dim_width_mm is null or dim_width_mm > 0),
  dim_height_mm        integer check (dim_height_mm is null or dim_height_mm > 0),
  dim_depth_mm         integer check (dim_depth_mm is null or dim_depth_mm > 0),
  weight_grams         integer check (weight_grams is null or weight_grams > 0),
  main_image_path      text,                          -- foto principal (bucket global)
  version              integer not null default 1,    -- sube en cada cambio => avisos
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id) on delete set null
);

-- La referencia del proveedor es la llave de cruce: única e insensible a may/min.
create unique index if not exists uniq_catalog_products_supplier_ref
  on public.catalog_products (lower(supplier_reference));
create index if not exists idx_catalog_products_manufacturer
  on public.catalog_products(manufacturer_id);

-- -----------------------------------------------------------------------------
-- Valores de atributos del producto maestro (usa los atributos GLOBALES por key)
-- -----------------------------------------------------------------------------
create table if not exists public.catalog_product_attributes (
  id                    uuid primary key default gen_random_uuid(),
  catalog_product_id    uuid not null references public.catalog_products(id) on delete cascade,
  attribute_global_key  text not null references public.product_attributes_global(key) on delete cascade,
  value_text            text,
  value_number          numeric,
  value_boolean         boolean,
  display_order         integer not null default 0,
  unique (catalog_product_id, attribute_global_key)
);

create index if not exists idx_cpa_product
  on public.catalog_product_attributes(catalog_product_id);

-- -----------------------------------------------------------------------------
-- Documentación del fabricante (manuales, fichas, certificados...)
-- -----------------------------------------------------------------------------
create table if not exists public.catalog_product_documents (
  id                  uuid primary key default gen_random_uuid(),
  catalog_product_id  uuid not null references public.catalog_products(id) on delete cascade,
  kind                app.product_document_kind not null default 'other',
  title               text not null,
  storage_path        text not null,                  -- bucket "catalog-global"
  file_size_bytes     integer,
  mime_type           text,
  display_order       integer not null default 0,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null
);

create index if not exists idx_cpd_product
  on public.catalog_product_documents(catalog_product_id);

-- -----------------------------------------------------------------------------
-- Fotos del producto maestro
-- -----------------------------------------------------------------------------
create table if not exists public.catalog_product_photos (
  id                  uuid primary key default gen_random_uuid(),
  catalog_product_id  uuid not null references public.catalog_products(id) on delete cascade,
  storage_path        text not null,                  -- bucket "catalog-global"
  alt_text            text,
  is_main             boolean not null default false,
  display_order       integer not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists idx_cpp_product
  on public.catalog_product_photos(catalog_product_id);

-- -----------------------------------------------------------------------------
-- Enganche desde el producto de la empresa hacia el maestro
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists catalog_product_id uuid
    references public.catalog_products(id) on delete set null;
alter table public.products
  add column if not exists catalog_version_synced integer;

create index if not exists idx_products_catalog_link
  on public.products(catalog_product_id) where catalog_product_id is not null;

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
drop trigger if exists trg_manufacturers_updated on public.manufacturers;
create trigger trg_manufacturers_updated
  before update on public.manufacturers
  for each row execute function app.set_updated_at();

drop trigger if exists trg_catalog_products_updated on public.catalog_products;
create trigger trg_catalog_products_updated
  before update on public.catalog_products
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: SOLO superadmin (lectura y escritura). Las empresas NO acceden con su
-- cliente; el cruce por referencia y la importación se hacen con service-role.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'manufacturers', 'catalog_products', 'catalog_product_attributes',
    'catalog_product_documents', 'catalog_product_photos'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
  end loop;
end $$;

comment on table public.manufacturers is
  'Fabricantes del catálogo maestro (superadmin). Global, sin company_id.';
comment on table public.catalog_products is
  'Productos maestros por fabricante (SIN precio/stock). Llave de cruce: supplier_reference. version sube en cada cambio para avisar a las empresas enganchadas.';

notify pgrst, 'reload schema';
