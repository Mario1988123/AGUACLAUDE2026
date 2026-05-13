-- ============================================================================
-- Fase 5 estado de pago del contrato
-- ----------------------------------------------------------------------------
-- Decisión usuario: el contrato puede estar
--   pending          → ningún cobro confirmado
--   paid_customer    → el cliente ha pagado (típico contado / domiciliación)
--   paid_financier   → la financiera ha pagado el capital empresa
--   reserve_pending  → la financiera pagó capital - reserva; queda la
--                      reserva pendiente hasta fin de contrato
--
-- La financiera tarda X días según cuál sea — no hay plazo fijo. El admin
-- confirma manualmente el pago desde wallet cuando llega el ingreso.
--
-- Campos auxiliares:
--   financier_paid_at       → fecha en que se confirmó el pago.
--   financier_paid_amount_cents → importe real recibido (puede diferir
--                                 del esperado por ajustes).
-- ============================================================================

alter table public.contracts
  add column if not exists payment_state text not null default 'pending'
    check (payment_state in ('pending', 'paid_customer', 'paid_financier', 'reserve_pending')),
  add column if not exists financier_paid_at timestamptz,
  add column if not exists financier_paid_amount_cents integer
    check (financier_paid_amount_cents is null or financier_paid_amount_cents >= 0);

create index if not exists idx_contracts_payment_state on public.contracts(company_id, payment_state)
  where deleted_at is null;

comment on column public.contracts.payment_state is
  'Estado del cobro del contrato. Solo informativo en wallet, no bloquea la instalación. pending/paid_customer/paid_financier/reserve_pending.';

notify pgrst, 'reload schema';
