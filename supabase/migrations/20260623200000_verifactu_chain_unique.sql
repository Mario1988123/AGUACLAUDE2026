-- =============================================================================
-- 20260623200000_verifactu_chain_unique.sql
--
-- Blinda la cadena de huellas Verifactu contra bifurcaciones por concurrencia.
-- Si dos emisiones leen el mismo prev_hash simultáneamente y ambas intentan
-- insertar su registro encadenado, el índice único hará que una falle y la
-- código de la app la trata como "carrera; reintenta" (rollback de la factura
-- a 'draft' en issueInvoiceV2Action; mensaje friendly al admin).
--
-- prev_hash='' es el primer registro de la cadena de la empresa → como mucho
-- uno por empresa (correcto).
-- =============================================================================

create unique index if not exists idx_verifactu_records_chain_unique
  on public.invoice_verifactu_records(company_id, prev_hash);

comment on index public.idx_verifactu_records_chain_unique is
  'Cadena de huellas Verifactu por empresa: cada prev_hash solo puede tener un sucesor.';

notify pgrst, 'reload schema';
