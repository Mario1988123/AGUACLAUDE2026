-- ============================================================================
-- RRSS — campos de marca por empresa
-- ----------------------------------------------------------------------------
-- AGUACLAUDE es el nombre del CRM, no de la empresa cliente. Cada empresa
-- que usa el CRM publica con SU nombre y SU hashtag. Estos dos campos se
-- inyectan en las plantillas al generar contenido.
-- ============================================================================

alter table public.social_settings
  add column if not exists brand_name text,
  add column if not exists brand_hashtag text;

comment on column public.social_settings.brand_name is
  'Nombre comercial que aparece en los copys (sustituye placeholder {{brand_name}}). Si null, se usa el nombre fiscal de la empresa.';
comment on column public.social_settings.brand_hashtag is
  'Hashtag principal de la marca (ej. #AguaPuraCanarias). Sustituye {{brand_hashtag}}. Si null, se omite.';

notify pgrst, 'reload schema';
