-- =============================================================================
-- Facturación y dinero (auditoría 01-10-2026: C3, C4, C6, I22, I23, I26, I32)
--
-- Idempotente: se puede ejecutar dos veces. Comprobado en producción antes de
-- escribirla (02-10-2026, solo SELECT):
--   · 0 duplicados de (contract_id, billing_period) en invoices
--   · 0 duplicados de wallet_entry_id en invoice_payments
--   · 0 remesas SEPA abiertas
--   · 0 contratos vivos repetidos por propuesta (source_proposal_id)
--   · 0 importes negativos en invoices, contract_payments y wallet_entries
--
-- Requiere antes 20261002130000_wallet_estado_cancelado.sql (no es
-- imprescindible: aquí no se usa 'cancelled' del wallet).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. C4 — Rectificativas por diferencias (líneas con cantidad negativa)
--    El CHECK quantity > 0 hacía imposible cualquier rectificativa: la
--    cabecera se numeraba, fallaba el insert de líneas y se quemaba el número.
--    Ahora se admite cualquier cantidad distinta de 0. Que una factura
--    ORDINARIA no lleve cantidades negativas lo valida el código antes de
--    numerar (src/modules/invoices/importes.ts → validarLineasFactura).
-- -----------------------------------------------------------------------------
alter table public.invoice_lines drop constraint if exists invoice_lines_quantity_check;
alter table public.invoice_lines
  add constraint invoice_lines_quantity_check check (quantity <> 0);

-- -----------------------------------------------------------------------------
-- 2. C6 — Devolución de fianza como movimiento de salida
--    contract_payments y wallet_entries no tienen columna de sentido; la
--    salida de caja se guarda en negativo. Se permite el negativo SOLO para
--    devoluciones ya validadas (concepto "Devolución…"), nunca para algo que
--    una remesa o GoCardless pudieran intentar cobrar (esos filtran 'pending').
-- -----------------------------------------------------------------------------
alter table public.contract_payments drop constraint if exists contract_payments_amount_cents_check;
alter table public.contract_payments
  add constraint contract_payments_amount_cents_check check (
    amount_cents >= 0
    or (status = 'validated' and concept like 'Devoluci%')
  );

alter table public.wallet_entries drop constraint if exists wallet_entries_amount_cents_check;
alter table public.wallet_entries
  add constraint wallet_entries_amount_cents_check check (
    amount_cents >= 0
    or (status in ('validated', 'settled') and concept like 'Devoluci%')
  );

-- -----------------------------------------------------------------------------
-- 3. I32 — allocate_next_invoice_number reinicia el año en hora de MADRID
--    Antes: extract(year from now()) en UTC, mientras que fiscal_year se
--    calcula en Madrid. El 1-ene a las 00:30 (Madrid) la factura salía con
--    año nuevo y el número del año anterior (F-2027-00348); a la 01:00 el
--    contador se reiniciaba y, al volver a 348, chocaba con el índice único.
--    Misma firma y mismo comportamiento salvo la zona horaria.
-- -----------------------------------------------------------------------------
create or replace function public.allocate_next_invoice_number(p_series_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_year integer;
  v_next bigint;
  v_cur_year integer;
  v_resets boolean;
begin
  v_year := extract(year from (now() at time zone 'Europe/Madrid'))::int;

  select current_year, resets_yearly
    into v_cur_year, v_resets
    from public.invoice_series
   where id = p_series_id
   for update;

  if not found then
    raise exception 'Serie no encontrada %', p_series_id;
  end if;

  if coalesce(v_resets, true) and coalesce(v_cur_year, v_year) <> v_year then
    update public.invoice_series
       set next_number = 1,
           current_year = v_year,
           updated_at = now()
     where id = p_series_id;
  end if;

  update public.invoice_series
     set next_number = next_number + 1,
         current_year = coalesce(current_year, v_year),
         updated_at = now()
   where id = p_series_id
   returning next_number - 1 into v_next;

  return v_next;
end
$function$;

revoke all on function public.allocate_next_invoice_number(uuid) from public, anon, authenticated;
grant execute on function public.allocate_next_invoice_number(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Versión del esquema de facturación
--    El código la consulta ANTES de numerar una rectificativa: si esta
--    migración no está aplicada, avisa sin quemar un número de serie.
-- -----------------------------------------------------------------------------
create or replace function public.facturacion_esquema_version()
returns integer
language sql
immutable
as $$ select 20261002 $$;

revoke all on function public.facturacion_esquema_version() from public, anon, authenticated;
grant execute on function public.facturacion_esquema_version() to service_role;

-- -----------------------------------------------------------------------------
-- 5. Índices únicos (idempotencia de verdad, no "leer y luego insertar")
-- -----------------------------------------------------------------------------
-- C3/I28: una sola cuota por contrato y periodo (cron y botón "Generar
-- cuotas"). No cuenta lo anulado (una cuota rectificada se puede volver a
-- emitir), ni las remesas de mantenimiento, ni las facturas a financiera.
create unique index if not exists uniq_invoices_contract_period
  on public.invoices (contract_id, billing_period)
  where kind = 'invoice'
    and contract_id is not null
    and billing_period is not null
    and maintenance_contract_id is null
    and financier_id is null
    and deleted_at is null
    and status not in ('cancelled', 'void');

-- I22: un cobro del wallet se aplica UNA vez a una factura.
create unique index if not exists uniq_invoice_payments_wallet
  on public.invoice_payments (wallet_entry_id)
  where wallet_entry_id is not null;

-- I23: una sola remesa SEPA abierta por empresa (dos clics = dos remesas con
-- los mismos cobros).
create unique index if not exists uniq_sepa_batch_open
  on public.sepa_batches (company_id)
  where status = 'open';

-- I26: un solo contrato vivo por propuesta (dos clics en "Generar contrato"
-- creaban C-2026-0002 duplicado). 0 duplicados en producción el 02-10-2026.
create unique index if not exists uniq_contracts_source_proposal
  on public.contracts (source_proposal_id)
  where source_proposal_id is not null
    and deleted_at is null;

-- -----------------------------------------------------------------------------
-- 6. I22 — Registrar el cobro de una factura de forma atómica
--    Bloquea la factura (FOR UPDATE), comprueba tipo, estado e importe
--    (nunca más de lo pendiente), es idempotente por wallet_entry_id y, si se
--    pide, crea el wallet validado en la MISMA transacción.
--    p_permitir_borrador: los flujos automáticos (wallet, GoCardless) cobran
--    la cuota que el cron dejó en borrador; al saldarse pasa a 'paid' con
--    issued_at = ahora. El botón manual lo llama con false.
--    Errores de negocio: SQLSTATE P0001 con el mensaje en español.
-- -----------------------------------------------------------------------------
create or replace function public.registrar_cobro_factura(
  p_company_id uuid,
  p_invoice_id uuid,
  p_amount_cents integer,
  p_wallet_entry_id uuid default null,
  p_user_id uuid default null,
  p_permitir_borrador boolean default false,
  p_crear_wallet boolean default false,
  p_metodo text default 'transfer',
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $function$
declare
  v_inv record;
  v_pagado bigint;
  v_pendiente bigint;
  v_pago uuid;
  v_wallet uuid := p_wallet_entry_id;
  v_estado text;
begin
  select id, company_id, kind::text as kind, status::text as status, total_cents,
         contract_id, customer_id, full_reference
    into v_inv
    from public.invoices
   where id = p_invoice_id
     and company_id = p_company_id
     and deleted_at is null
   for update;
  if not found then
    raise exception 'Factura no encontrada' using errcode = 'P0001';
  end if;

  -- Idempotencia: este cobro del wallet ya se aplicó.
  if v_wallet is not null then
    select id into v_pago
      from public.invoice_payments
     where wallet_entry_id = v_wallet
     limit 1;
    if found then
      return jsonb_build_object(
        'payment_id', v_pago, 'wallet_entry_id', v_wallet,
        'status', v_inv.status, 'ya_existia', true);
    end if;
  end if;

  if v_inv.kind <> 'invoice' then
    raise exception 'Solo se cobran facturas ordinarias' using errcode = 'P0001';
  end if;
  if v_inv.status = 'draft' and not p_permitir_borrador then
    raise exception 'Emite la factura antes de registrar el cobro' using errcode = 'P0001';
  end if;
  if v_inv.status = 'paid' then
    raise exception 'La factura ya está totalmente cobrada' using errcode = 'P0001';
  end if;
  if v_inv.status not in ('draft', 'issued', 'overdue') then
    raise exception 'No se puede cobrar una factura en estado %', v_inv.status using errcode = 'P0001';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'El importe del cobro debe ser mayor que 0' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount_cents), 0) into v_pagado
    from public.invoice_payments
   where invoice_id = p_invoice_id;
  v_pendiente := v_inv.total_cents - v_pagado;
  if v_pendiente <= 0 then
    raise exception 'La factura ya está totalmente cobrada' using errcode = 'P0001';
  end if;
  if p_amount_cents > v_pendiente then
    raise exception 'El cobro (% céntimos) supera lo pendiente (% céntimos)', p_amount_cents, v_pendiente
      using errcode = 'P0001';
  end if;

  if p_crear_wallet then
    insert into public.wallet_entries (
      company_id, contract_id, customer_id, invoice_id, concept, amount_cents,
      method, status, collected_at, collected_by_user_id, validated_at, validated_by_user_id)
    values (
      p_company_id, v_inv.contract_id, v_inv.customer_id, p_invoice_id,
      coalesce(p_notas, 'Cobro factura ' || v_inv.full_reference), p_amount_cents,
      p_metodo::app.payment_method, 'validated', now(), p_user_id, now(), p_user_id)
    returning id into v_wallet;
  end if;

  insert into public.invoice_payments (company_id, invoice_id, wallet_entry_id, amount_cents, created_by, notes)
  values (p_company_id, p_invoice_id, v_wallet, p_amount_cents, p_user_id, p_notas)
  returning id into v_pago;

  v_estado := v_inv.status;
  if p_amount_cents = v_pendiente then
    update public.invoices
       set status = 'paid',
           paid_at = now(),
           issued_at = case when v_inv.status = 'draft' then coalesce(issued_at, now()) else issued_at end
     where id = p_invoice_id;
    v_estado := 'paid';
  end if;

  return jsonb_build_object(
    'payment_id', v_pago,
    'wallet_entry_id', v_wallet,
    'status', v_estado,
    'pendiente_cents', v_pendiente - p_amount_cents,
    'ya_existia', false);
end
$function$;

revoke all on function public.registrar_cobro_factura(uuid, uuid, integer, uuid, uuid, boolean, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_cobro_factura(uuid, uuid, integer, uuid, uuid, boolean, boolean, text, text)
  to service_role;

commit;

-- Para que PostgREST vea las funciones nuevas sin esperar:
notify pgrst, 'reload schema';
