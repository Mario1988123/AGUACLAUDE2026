-- =============================================================================
-- Backfill customer_id en wallet_entries antiguos
-- =============================================================================
-- Antes el insert en collectContractPaymentAction NO incluía customer_id,
-- así que los wallet_entries históricos tienen customer_id null aunque su
-- contract_id sí está poblado. Eso impide:
--   1. Mostrar la columna "Cliente" en /wallet.
--   2. Crear factura desde un wallet entry (necesita customer_id).
--
-- Esta migración deduce el customer_id a partir del contrato vinculado.
-- =============================================================================

update public.wallet_entries we
set customer_id = c.customer_id
from public.contracts c
where we.contract_id = c.id
  and we.customer_id is null
  and we.company_id = c.company_id;

-- También backfill desde contract_payments si tiene contract pero no contract_id
update public.wallet_entries we
set customer_id = c.customer_id
from public.contract_payments cp
join public.contracts c on c.id = cp.contract_id
where we.contract_payment_id = cp.id
  and we.customer_id is null
  and we.company_id = c.company_id;
