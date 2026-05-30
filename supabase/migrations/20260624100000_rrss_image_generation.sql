-- =============================================================================
-- 20260624100000_rrss_image_generation.sql
--
-- Soporte para generación de imágenes de RRSS con IA (Gemini 2.5 Flash Image).
-- Antes el módulo social tenía image_prompt como texto fijo de plantilla y
-- image_url vacío. Ahora:
--   1. social_settings añade columnas de configuración visual de la empresa
--      (estilo, paleta, keywords, restricciones, presupuesto/cap).
--   2. social_posts añade metadata + coste de la generación.
-- =============================================================================

alter table public.social_settings
  add column if not exists image_provider              text
    check (image_provider is null or image_provider in ('none', 'gemini'))
    default 'none',
  add column if not exists image_style                 text
    check (image_style is null or image_style in (
      'photoreal', 'flat', 'illustration', '3d', 'editorial', 'minimalist'
    ))
    default 'editorial',
  add column if not exists brand_palette_primary       text,  -- #4880FF
  add column if not exists brand_palette_secondary     text,
  add column if not exists brand_palette_accent        text,
  add column if not exists brand_visual_keywords       text,  -- texto libre
  add column if not exists brand_location_hint         text,  -- "Galicia costera"
  add column if not exists forbidden_visual_elements   text[] default array[]::text[],
  add column if not exists preferred_visual_elements   text[] default array[]::text[],
  add column if not exists monthly_image_budget_cents  integer default 500,
  add column if not exists images_used_this_month      integer default 0,
  add column if not exists images_used_period_start    date default date_trunc('month', now())::date;

comment on column public.social_settings.image_provider is
  'Proveedor de generación de imagen IA. "none" = imagen manual; "gemini" = Google Gemini Flash Image.';
comment on column public.social_settings.image_style is
  'Estilo visual del que tirar todos los prompts de la empresa.';
comment on column public.social_settings.brand_visual_keywords is
  'Texto libre que se inserta literalmente en el prompt — "Galicia, casas de piedra, luz fría".';
comment on column public.social_settings.forbidden_visual_elements is
  'Lista de cosas que NO debe aparecer en la imagen (caras de personas, banderas, marcas competidoras…).';
comment on column public.social_settings.monthly_image_budget_cents is
  'Tope mensual de gasto en imágenes IA en céntimos. Default 500 (5 €/mes).';

-- =============================================================================
-- Metadata de generación por post
-- =============================================================================
alter table public.social_posts
  add column if not exists image_generation_metadata   jsonb,
  add column if not exists image_generation_cost_cents integer,
  add column if not exists image_generated_at          timestamptz,
  add column if not exists image_prompt_final          text;
  -- image_prompt = lo que la plantilla generó (genérico)
  -- image_prompt_final = lo que se mandó realmente a Gemini (enriquecido + edits del admin)

comment on column public.social_posts.image_prompt_final is
  'Prompt que se envió REAL al proveedor IA. Distinto de image_prompt (que es el de plantilla). Si admin edita antes de generar, aquí queda lo final.';
comment on column public.social_posts.image_generation_metadata is
  'JSON con detalles del envío: { provider, model, seed, cost_cents, dimensions, generated_at, prompt_chars }.';

notify pgrst, 'reload schema';
