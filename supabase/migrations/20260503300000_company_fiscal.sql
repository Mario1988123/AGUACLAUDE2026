-- =============================================================================
-- 20260503300000_company_fiscal.sql
-- Datos fiscales centralizados de la empresa emisora. Se usan en facturas,
-- contratos (snapshot al firmar), propuestas (cabecera del PDF) y cualquier
-- documento legal generado.
-- =============================================================================

alter table public.company_settings
  add column if not exists fiscal_legal_name      text,
  add column if not exists fiscal_tax_id          text,    -- CIF/NIF
  add column if not exists fiscal_street          text,
  add column if not exists fiscal_postal_code     text,
  add column if not exists fiscal_city            text,
  add column if not exists fiscal_province        text,
  add column if not exists fiscal_country         text default 'España',
  add column if not exists fiscal_email           text,
  add column if not exists fiscal_phone           text,
  add column if not exists fiscal_iban            text,
  add column if not exists fiscal_mercantile_reg  text,    -- "Inscrita en RM Madrid, Tomo X, Folio Y..."
  add column if not exists fiscal_logo_url        text,
  add column if not exists invoice_default_iva    numeric(5,2) not null default 21.00,
  add column if not exists invoice_default_due_days integer not null default 30,
  add column if not exists invoice_footer_text    text;    -- pie legal opcional

comment on column public.company_settings.fiscal_legal_name is
  'Razón social que aparece como emisora en facturas, contratos y propuestas.';
comment on column public.company_settings.fiscal_tax_id is
  'CIF/NIF de la empresa emisora.';
