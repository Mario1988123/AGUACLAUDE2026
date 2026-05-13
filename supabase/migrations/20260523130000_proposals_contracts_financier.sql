-- ============================================================================
-- Fase 4 vincular financiera a propuestas y contratos
-- ----------------------------------------------------------------------------
-- Propuestas y contratos renting/financing arrastran:
--   financier_id            → FK a la financiera elegida
--   financier_payment_cents → capital que percibe la empresa (editable
--                              por scoring; se rellena por defecto con
--                              cuota / coeficiente del plazo)
--   financier_term_months   → plazo usado (12/24/36/48/60)
--   financier_coefficient   → coeficiente aplicado (snapshot — la tabla
--                              de coeficientes puede cambiar después)
--   financier_residual_cents→ cuota residual al final (renting_strict)
--   financier_reserve_cents → reserva retenida hasta fin de contrato
--
-- En la factura emitida a la financiera, base = financier_payment_cents
-- (sin IVA) y se suma IVA 21%.
-- ============================================================================

-- proposals
alter table public.proposals
  add column if not exists financier_id              uuid references public.financiers(id) on delete set null,
  add column if not exists financier_payment_cents   integer
    check (financier_payment_cents is null or financier_payment_cents >= 0),
  add column if not exists financier_term_months     integer
    check (financier_term_months is null or financier_term_months > 0),
  add column if not exists financier_coefficient     numeric(10,6)
    check (financier_coefficient is null or financier_coefficient > 0),
  add column if not exists financier_residual_cents  integer
    check (financier_residual_cents is null or financier_residual_cents >= 0),
  add column if not exists financier_reserve_cents   integer
    check (financier_reserve_cents is null or financier_reserve_cents >= 0);

create index if not exists idx_proposals_financier on public.proposals(financier_id)
  where financier_id is not null;

-- contracts: copia al firmar.
alter table public.contracts
  add column if not exists financier_id              uuid references public.financiers(id) on delete set null,
  add column if not exists financier_payment_cents   integer
    check (financier_payment_cents is null or financier_payment_cents >= 0),
  add column if not exists financier_term_months     integer
    check (financier_term_months is null or financier_term_months > 0),
  add column if not exists financier_coefficient     numeric(10,6)
    check (financier_coefficient is null or financier_coefficient > 0),
  add column if not exists financier_residual_cents  integer
    check (financier_residual_cents is null or financier_residual_cents >= 0),
  add column if not exists financier_reserve_cents   integer
    check (financier_reserve_cents is null or financier_reserve_cents >= 0);

create index if not exists idx_contracts_financier on public.contracts(financier_id)
  where financier_id is not null;

notify pgrst, 'reload schema';
