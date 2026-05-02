-- =============================================================================
-- 20260503120000_company_settings_contact.sql
-- Datos contacto + dirección fiscal de la empresa para imprimirlos en los PDFs.
-- =============================================================================

alter table public.company_settings
  add column if not exists contact_phone        text,
  add column if not exists contact_email        text,
  add column if not exists fiscal_address       text,
  add column if not exists fiscal_postal_code   text,
  add column if not exists fiscal_city          text,
  add column if not exists fiscal_province      text;

comment on column public.company_settings.contact_phone is
  'Teléfono que aparece en cabecera de contratos/propuestas.';
comment on column public.company_settings.fiscal_address is
  'Dirección fiscal mostrada en sección "LA EMPRESA" del PDF.';
