-- =============================================================================
-- 20260525130000_wallet_entries_customer_backfill.sql
-- Backfill: rellena wallet_entries.customer_id cuando es NULL pero el
-- contract_id sí tiene customer_id en contracts. Era un bug del flujo
-- de firma de contrato (markContractSigned) que no propagaba customer_id
-- al crear las wallet_entries — en /wallet la columna Cliente salía "—".
-- =============================================================================

update public.wallet_entries we
set customer_id = c.customer_id
from public.contracts c
where we.customer_id is null
  and we.contract_id is not null
  and we.contract_id = c.id
  and c.customer_id is not null;

notify pgrst, 'reload schema';
