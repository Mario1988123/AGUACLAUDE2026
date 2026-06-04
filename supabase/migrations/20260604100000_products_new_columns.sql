-- =============================================================================
-- 20260604100000_products_new_columns.sql
-- Fase 1 del Plan Productos v2 (2026-06-04).
-- Añade columnas nuevas a `products` para soportar:
--   - Tags multicolor por producto (filtros y UX)
--   - Marketing claim (frase corta destacada en ficha técnica y catálogo)
--   - URL de vídeo YouTube
--   - URL custom para el QR del datasheet
--   - Código de barras EAN-13 (escaneo en almacén)
--   - País de origen (ISO 3166-1)
--   - Fabricante (marca y modelo, distintos del nombre comercial)
--   - Garantías por bloque (general, electrónica, carcasa)
--   - Discontinuado (distinto de inactivo / borrado): no se vende a nuevos
--     pero sigue dándose servicio.
--   - Producto que lo reemplaza (si discontinuado)
--   - Esquema de instalación (PNG/SVG) para meter en ficha y catálogo
--   - Color override del datasheet por producto (opcional, por defecto hereda
--     de companies.pdf_brand_color)
--
-- NOTAS:
--   - NO se crea brand_color en companies: ya existe `companies.pdf_brand_color`
--     desde 20260501120200_tenant_core_tables.sql (default '#2563eb').
--   - Todas las columnas son NULLABLE: la migración no afecta a productos
--     existentes ni rompe queries actuales.
-- =============================================================================

alter table public.products
  add column if not exists tags                       text[]      default '{}',
  add column if not exists marketing_claim            text,
  add column if not exists youtube_url                text,
  add column if not exists qr_target_url              text,
  add column if not exists barcode_ean13              text,
  add column if not exists country_of_origin          text,
  add column if not exists manufacturer_name          text,
  add column if not exists manufacturer_model         text,
  add column if not exists warranty_months_general    integer     check (warranty_months_general is null or warranty_months_general >= 0),
  add column if not exists warranty_months_electronics integer    check (warranty_months_electronics is null or warranty_months_electronics >= 0),
  add column if not exists warranty_months_body       integer     check (warranty_months_body is null or warranty_months_body >= 0),
  add column if not exists discontinued_at            timestamptz,
  add column if not exists replaced_by_product_id     uuid        references public.products(id) on delete set null,
  add column if not exists installation_diagram_url   text,
  add column if not exists datasheet_color_accent     text;

-- Validaciones suaves: country_of_origin esperado ISO 3166-1 alpha-2 (2 letras)
alter table public.products
  drop constraint if exists products_country_of_origin_check;
alter table public.products
  add  constraint  products_country_of_origin_check
  check (country_of_origin is null or length(country_of_origin) = 2);

-- Índice GIN sobre tags para filtros rápidos por tag en /productos
create index if not exists idx_products_tags
  on public.products using gin (tags)
  where deleted_at is null;

-- Índice parcial para listado de discontinuados activos
create index if not exists idx_products_discontinued
  on public.products(company_id, discontinued_at)
  where discontinued_at is not null and deleted_at is null;

-- Índice búsqueda por código de barras
create index if not exists idx_products_barcode
  on public.products(company_id, barcode_ean13)
  where barcode_ean13 is not null and deleted_at is null;

comment on column public.products.tags is
  'Tags libres por producto (ej. {"promo-junio","bestseller","horeca"}). Filtrable en listado.';
comment on column public.products.marketing_claim is
  'Frase corta destacada en ficha técnica y catálogo (máx ~120 chars). Ej.: "Hasta 50% menos consumo de sal".';
comment on column public.products.discontinued_at is
  'Discontinuado: no se vende a clientes nuevos, pero sigue dando servicio (mantenimientos, recambios). Distinto de is_active=false (oculto del todo) y deleted_at (soft-delete).';
comment on column public.products.replaced_by_product_id is
  'Si está discontinuado, qué producto del catálogo lo sustituye.';
comment on column public.products.datasheet_color_accent is
  'Override del color de cabecera del PDF de ficha técnica. Si NULL hereda de companies.pdf_brand_color.';

notify pgrst, 'reload schema';
