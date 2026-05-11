-- ============================================================================
-- proposal_default_validity_days en company_settings
-- ----------------------------------------------------------------------------
-- Antes el form de propuestas usaba 15 días hardcoded. Ahora cada empresa
-- puede configurar su default. Cuando un comercial crea una propuesta sin
-- fecha de validez, se toma este valor.
-- ============================================================================

alter table public.company_settings
  add column if not exists proposal_default_validity_days integer
    not null default 30
    check (proposal_default_validity_days > 0 and proposal_default_validity_days <= 365);

comment on column public.company_settings.proposal_default_validity_days is
  'Días de validez por defecto de las propuestas. Si el comercial no marca fecha, se aplica este valor desde la creación.';

-- pgrst reload
notify pgrst, 'reload schema';
