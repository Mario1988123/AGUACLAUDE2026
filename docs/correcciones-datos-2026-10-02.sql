-- =============================================================================
-- CORRECCIÓN DE DATOS — 02-10-2026 (auditoría 01-10-2026, C3 y C6)
--
-- NO es una migración: se ejecuta A MANO, una vez, revisando antes cada
-- SELECT. Cada UPDATE lleva en el WHERE el estado y el importe esperados, así
-- que si los datos han cambiado no toca nada (y repetirlo no hace daño).
--
-- Orden recomendado:
--   1. Aplicar las migraciones 20261002130000 y 20261002130100.
--   2. Ejecutar este fichero bloque a bloque.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- BLOQUE 1 · C3 — La cuota de 100,00 € del particular se facturó por 100,01 €
--
-- Factura F-2026-00007 (contrato b3be5011…), creada por el cron la noche del
-- 01-10. Está en BORRADOR (status = 'draft'): no se ha emitido ni cobrado,
-- así que se corrige el borrador en vez de rectificarlo. Si cuando lo vayas a
-- ejecutar ya estuviera emitida, el WHERE (status = 'draft') no tocará nada y
-- habría que rectificarla desde la aplicación.
--
-- Correcto: 100,00 € IVA incluido = base 82,64 + IVA 17,36.
-- Guardado: base 82,65 + IVA 17,36 = 100,01 €.
-- -----------------------------------------------------------------------------

-- 1.a Ver lo afectado (debe salir 1 fila de cabecera y 1 de línea con 8265 / 1736 / 10001)
select i.id, i.full_reference, i.status, i.subtotal_cents, i.tax_cents, i.total_cents,
       l.id as linea_id, l.unit_price_cents, l.subtotal_cents as l_sub, l.tax_cents as l_iva, l.total_cents as l_total
  from public.invoices i
  join public.invoice_lines l on l.invoice_id = i.id
 where i.id = '8b4a1cb8-2a12-4d51-96ba-7b439523cfad';

begin;
update public.invoice_lines
   set unit_price_cents = 8264, subtotal_cents = 8264, tax_cents = 1736, total_cents = 10000
 where invoice_id = '8b4a1cb8-2a12-4d51-96ba-7b439523cfad'
   and subtotal_cents = 8265 and tax_cents = 1736 and total_cents = 10001
   and exists (select 1 from public.invoices
                where id = '8b4a1cb8-2a12-4d51-96ba-7b439523cfad' and status = 'draft');
update public.invoices
   set subtotal_cents = 8264, tax_cents = 1736, total_cents = 10000
 where id = '8b4a1cb8-2a12-4d51-96ba-7b439523cfad'
   and status = 'draft'
   and subtotal_cents = 8265 and tax_cents = 1736 and total_cents = 10001;
-- Comprobación: debe salir 8264 / 1736 / 10000 en cabecera y línea. Si no, ROLLBACK.
select i.subtotal_cents, i.tax_cents, i.total_cents, l.subtotal_cents, l.tax_cents, l.total_cents
  from public.invoices i join public.invoice_lines l on l.invoice_id = i.id
 where i.id = '8b4a1cb8-2a12-4d51-96ba-7b439523cfad';
commit;


-- -----------------------------------------------------------------------------
-- BLOQUE 2 · C3 — Enlazar los cobros de las 2 cuotas con su factura
--
-- El cron creó los wallet_entries sin invoice_id. Sin el enlace, al validar el
-- cobro aparece en "pendientes de facturar" y "Facturar" crearía una SEGUNDA
-- factura del mes, mientras la del cron seguiría impagada. Con el enlace, al
-- validar el cobro se aplica a su factura (invoice_payment + "paid").
-- También se enlaza el contract_payment con su wallet.
--
-- Ojo: el wallet de la cuota del particular es de 10000; cuadra con la
-- factura SOLO después del bloque 1.
-- -----------------------------------------------------------------------------

-- 2.a Ver lo afectado (2 filas, invoice_id NULL, pending)
select w.id, w.status, w.amount_cents, w.invoice_id, w.contract_payment_id,
       i.full_reference, i.total_cents, i.billing_period
  from public.wallet_entries w
  join public.invoices i on i.contract_id = w.contract_id and i.billing_period = '2026-10' and i.kind = 'invoice'
 where w.id in ('aa5160a9-cee3-4dcb-a403-424f461752ff', 'a23e99ff-ccb2-4f8a-adfb-0bf5e85a5805');

begin;
update public.wallet_entries
   set invoice_id = '77e580b6-4f05-49e5-b597-7ddd5f054b6a'   -- F-2026-00006 (empresa, 121,00 €)
 where id = 'aa5160a9-cee3-4dcb-a403-424f461752ff'
   and invoice_id is null and amount_cents = 12100;
update public.wallet_entries
   set invoice_id = '8b4a1cb8-2a12-4d51-96ba-7b439523cfad'   -- F-2026-00007 (particular, 100,00 €)
 where id = 'a23e99ff-ccb2-4f8a-adfb-0bf5e85a5805'
   and invoice_id is null and amount_cents = 10000;
update public.contract_payments cp
   set wallet_entry_id = w.id
  from public.wallet_entries w
 where w.contract_payment_id = cp.id
   and cp.wallet_entry_id is null
   and w.id in ('aa5160a9-cee3-4dcb-a403-424f461752ff', 'a23e99ff-ccb2-4f8a-adfb-0bf5e85a5805');
-- Comprobación: los 2 wallets con invoice_id. Si no, ROLLBACK.
select id, invoice_id from public.wallet_entries
 where id in ('aa5160a9-cee3-4dcb-a403-424f461752ff', 'a23e99ff-ccb2-4f8a-adfb-0bf5e85a5805');
commit;


-- -----------------------------------------------------------------------------
-- BLOQUE 3 · C6 — Cobro vivo de un contrato CANCELADO
--
-- Contrato C-2026-0001 (43544e2c…), cancelado: tiene 1 contract_payment
-- 'pending' de 50,00 € (transferencia, a la firma) y su wallet 'pending'.
-- No está en ninguna remesa. Se cancelan los dos.
-- El wallet pasa a 'cancelled' → REQUIERE la migración 20261002130000. Si no
-- está aplicada, cambia 'cancelled' por 'rejected' en el UPDATE del wallet.
-- -----------------------------------------------------------------------------

-- 3.a Ver lo afectado (1 contract_payment y 1 wallet, ambos pending, 5000)
select c.reference_code, c.status as contrato, cp.id as cp_id, cp.status as cp_status, cp.amount_cents,
       cp.sepa_batch_id, w.id as wallet_id, w.status as wallet_status, w.amount_cents as wallet_importe
  from public.contracts c
  join public.contract_payments cp on cp.contract_id = c.id
  left join public.wallet_entries w on w.contract_id = c.id
 where c.id = '43544e2c-6a5c-41e2-99c4-ea8ab3fff679';

begin;
update public.contract_payments
   set status = 'cancelled', notes = coalesce(notes || ' · ', '') || 'Contrato cancelado (corrección 02-10-2026)'
 where id = 'ebebe057-3193-4b62-af1f-e453b2d33671'
   and status = 'pending' and sepa_batch_id is null
   and exists (select 1 from public.contracts where id = '43544e2c-6a5c-41e2-99c4-ea8ab3fff679' and status = 'cancelled');
update public.wallet_entries
   set status = 'cancelled',
       rejected_reason = 'Contrato cancelado (corrección 02-10-2026)',
       validated_at = now()
 where id = '4efc42fb-38b4-41f0-8d20-6d1ee39fe9ef'
   and status = 'pending'
   and contract_id = '43544e2c-6a5c-41e2-99c4-ea8ab3fff679';
-- Comprobación: 'cancelled' en los dos. Si no, ROLLBACK.
select (select status from public.contract_payments where id = 'ebebe057-3193-4b62-af1f-e453b2d33671') as cp,
       (select status from public.wallet_entries where id = '4efc42fb-38b4-41f0-8d20-6d1ee39fe9ef') as wallet;
commit;


-- -----------------------------------------------------------------------------
-- BLOQUE 4 · SOLO CONSULTA — GoCardless (sandbox): 3 cargos para el mismo cobro
--
-- Hay 3 gocardless_payments 'pending_submission' de 99,00 € para el MISMO
-- contract_payment (55af70ff…), creados el 19-05 con segundos de diferencia
-- (el fallo de I24: clave de idempotencia aleatoria). El entorno es SANDBOX,
-- así que no hay dinero real. No se toca nada aquí: si se quiere limpiar,
-- cancelarlos en el panel de GoCardless sandbox (el webhook los pondrá en
-- 'cancelled'). Además impiden crear un índice único de "un pago vivo por
-- contract_payment", por eso esa protección va en el código.
-- -----------------------------------------------------------------------------
select gp.id, gp.status, gp.amount_cents, gp.created_at, s.environment
  from public.gocardless_payments gp
  join public.gocardless_settings s on s.company_id = gp.company_id
 where gp.contract_payment_id = '55af70ff-05c8-475a-ad34-491f31fbf921';
