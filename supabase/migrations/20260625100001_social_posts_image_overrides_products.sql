-- =============================================================================
-- 20260625100001_social_posts_image_overrides_products.sql
--
-- Permite que cada post tenga su propia configuración de generación de imagen,
-- sin tocar los defaults de social_settings. Y que se vinculen 0+ productos del
-- catálogo para que aparezcan/se inspire en ellos.
--
--   image_overrides JSONB — campos sueltos que ganan a los defaults si vienen:
--     { style, palette: {primary, secondary, accent}, keywords, location,
--       forbidden: [], preferred: [],
--       logo_enabled, logo_position, logo_size_pct,
--       watermark_text, watermark_text_enabled, watermark_text_position,
--       watermark_text_color }
--   product_ids UUID[] — IDs de products. Sin FK directa (Postgres no soporta
--     FK en columnas array). Validamos en server action.
-- =============================================================================

alter table public.social_posts
  add column if not exists image_overrides jsonb,
  add column if not exists product_ids     uuid[] default array[]::uuid[];

comment on column public.social_posts.image_overrides is
  'JSON con overrides por imagen sobre los defaults de social_settings. NULL = usar todo por defecto.';
comment on column public.social_posts.product_ids is
  'IDs de products del catálogo a incluir en el prompt (nombre + descripción + foto si tiene). Sin FK directa, validar en server action.';

-- Índice GIN para futuras búsquedas "posts que mencionan producto X"
create index if not exists idx_social_posts_product_ids
  on public.social_posts using gin (product_ids);

notify pgrst, 'reload schema';
