-- =============================================================================
-- 20260625100000_social_settings_watermark_defaults.sql
--
-- Defaults globales por empresa para overlay de LOGO y TEXTO sobre las imágenes
-- generadas por IA. El logo en sí NO se duplica aquí: se lee de
-- company_settings.fiscal_logo_url (subido en /configuracion/fiscal). Aquí solo
-- vivien las preferencias visuales por defecto, que cada post puede sobreescribir
-- puntualmente vía social_posts.image_overrides.
-- =============================================================================

alter table public.social_settings
  add column if not exists logo_overlay_enabled_default       boolean default true,
  add column if not exists logo_position_default              text
    check (logo_position_default is null or logo_position_default in (
      'top-left', 'top-right', 'bottom-left', 'bottom-right'
    ))
    default 'bottom-right',
  add column if not exists logo_size_pct_default              integer
    check (logo_size_pct_default is null or (logo_size_pct_default between 5 and 30))
    default 12,
  add column if not exists watermark_text_enabled_default     boolean default false,
  add column if not exists watermark_text_default             text,
  add column if not exists watermark_text_position_default    text
    check (watermark_text_position_default is null or watermark_text_position_default in (
      'top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center'
    ))
    default 'bottom-center',
  add column if not exists watermark_text_color_default       text default '#FFFFFF';

comment on column public.social_settings.logo_overlay_enabled_default is
  'Si TRUE, las imágenes IA se generan con el logo de la empresa pegado encima por defecto. Cada post puede desactivarlo puntualmente.';
comment on column public.social_settings.logo_position_default is
  'Esquina donde pegar el logo: top-left / top-right / bottom-left / bottom-right.';
comment on column public.social_settings.logo_size_pct_default is
  'Tamaño del logo como % del ancho de la imagen (5–30). 12% = legible sin tapar contenido.';
comment on column public.social_settings.watermark_text_default is
  'Texto opcional a sobreimprimir (nombre comercial, eslogan, etc). Vacío = no se pinta texto.';
comment on column public.social_settings.watermark_text_color_default is
  'Color HEX del texto de marca de agua. El módulo añade contorno auto-contraste.';

notify pgrst, 'reload schema';
