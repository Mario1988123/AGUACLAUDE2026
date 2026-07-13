-- =============================================================================
-- 20260713100000_revoke_public_rpc.sql
-- Cierra la exposición vía PostgREST de funciones public MUTADORAS que solo debe
-- llamar el service_role. Mismo tipo de agujero que adjust_stock_batch (C1):
-- Supabase concede EXECUTE a authenticated/anon por defecto sobre funciones de
-- `public`; sin `revoke` quedan llamables desde /rest/v1/rpc/... por cualquier
-- usuario autenticado.
--
-- · allocate_next_invoice_number(uuid): security definer, incrementa el contador
--   de una invoice_series SIN validar pertenencia. Un usuario de la empresa A
--   podía llamarla con un p_series_id de la empresa B y quemar/saltar números de
--   su secuencia fiscal → HUECOS en la numeración (problema legal AEAT/Verifactu).
--   La app la llama SOLO vía admin (service_role): invoices/actions.ts:383,
--   verifactu-actions.ts:660. (La app ya valida la serie por company_id antes.)
-- · autoclose_stale_punches(): cierra fichajes; la llaman solo crons/admin.
--   Higiene (evita que un authenticated dispare el cierre masivo).
--
-- NO se tocan los seed_* : seed_default_clauses se llama con cliente RLS
-- (contracts/actions.ts:331) y revocarlo lo rompería; además son de bajo impacto.
-- =============================================================================

revoke execute on function public.allocate_next_invoice_number(uuid) from public, anon, authenticated;
grant  execute on function public.allocate_next_invoice_number(uuid) to service_role;

revoke execute on function public.autoclose_stale_punches() from public, anon, authenticated;
grant  execute on function public.autoclose_stale_punches() to service_role;

notify pgrst, 'reload schema';
