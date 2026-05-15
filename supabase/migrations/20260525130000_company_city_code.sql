-- =============================================================================
-- 20260525130000_company_city_code.sql
-- Añadir city_code a company_settings para festivos locales (autocarga).
-- =============================================================================

alter table public.company_settings
  add column if not exists city_code text;

comment on column public.company_settings.city_code is
  'Código de ciudad (ej. ES-V-VALENCIA) para sugerir festivos locales en /configuracion/festivos.';

notify pgrst, 'reload schema';
