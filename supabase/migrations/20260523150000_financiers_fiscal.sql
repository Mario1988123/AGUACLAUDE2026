-- ============================================================================
-- Fase 6 datos fiscales de la financiera para emisión de factura
-- ----------------------------------------------------------------------------
-- Para emitir la factura del renting a la financiera (Fase 6) necesitamos
-- guardar su razón social, CIF, domicilio fiscal e IBAN. Estos datos se
-- imprimen como destinatario en la factura y se usan también si en algún
-- momento se exporta a Verifactu.
-- ============================================================================

alter table public.financiers
  add column if not exists fiscal_legal_name   text,
  add column if not exists fiscal_tax_id       text,
  add column if not exists fiscal_street       text,
  add column if not exists fiscal_postal_code  text,
  add column if not exists fiscal_city         text,
  add column if not exists fiscal_province     text,
  add column if not exists fiscal_country      text not null default 'España',
  add column if not exists fiscal_email        text,
  add column if not exists fiscal_phone        text,
  add column if not exists fiscal_iban         text;

comment on column public.financiers.fiscal_legal_name is
  'Razón social de la financiera (destinatario en factura del renting).';

notify pgrst, 'reload schema';
