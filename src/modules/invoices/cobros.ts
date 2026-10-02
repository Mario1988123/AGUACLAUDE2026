import "server-only";

import { validarCobroFactura } from "./importes";

/**
 * COBROS DE FACTURAS — camino único (sin sesión; NO es "use server")
 *
 * Lo usan: "Marcar cobrada" (/facturas), validar un cobro del wallet, el
 * webhook de GoCardless y la facturación desde el wallet. Antes cada uno
 * leía lo cobrado, sumaba y escribía por su cuenta: un doble clic creaba dos
 * cobros, se podía cobrar una factura cancelada y no había tope.
 *
 * Camino principal: RPC `registrar_cobro_factura` (migración
 * 20261002130100), que bloquea la factura con SELECT … FOR UPDATE, valida
 * estado e importe y hace todo en una transacción. Si la migración aún no
 * está aplicada, se usa un camino de respaldo con las MISMAS validaciones
 * (sin bloqueo) para no dejar el botón roto entre despliegue y migración.
 */

export interface RegistrarCobroArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  companyId: string;
  invoiceId: string;
  importeCents: number;
  /** Cobro del wallet que lo respalda (idempotencia: uno por wallet). */
  walletEntryId?: string | null;
  usuarioId?: string | null;
  /**
   * Las cuotas del cron nacen en borrador y el dinero llega antes de que
   * nadie las "emita". En los flujos automáticos (wallet, GoCardless) se
   * permite cobrar un borrador, que pasa a pagada con issued_at = ahora.
   * El botón manual exige que esté emitida.
   */
  permitirBorrador?: boolean;
  /** Crea el wallet_entry validado dentro de la misma transacción. */
  crearWallet?: { metodo: string } | null;
  notas?: string | null;
}

export interface RegistrarCobroResultado {
  payment_id: string | null;
  wallet_entry_id: string | null;
  status: string;
  ya_existia: boolean;
}

function rpcNoExiste(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    /Could not find the function|registrar_cobro_factura.*does not exist/i.test(error.message ?? "")
  );
}

export async function registrarCobroFactura(
  args: RegistrarCobroArgs,
): Promise<RegistrarCobroResultado> {
  const { admin } = args;
  // Si un cobro automático va a pasar un BORRADOR a pagada, esa es su
  // emisión: después se registra en VeriFactu (Verifacti) si procede.
  let eraBorrador = false;
  if (args.permitirBorrador) {
    const { data: prev } = await admin
      .from("invoices")
      .select("status")
      .eq("id", args.invoiceId)
      .eq("company_id", args.companyId)
      .maybeSingle();
    eraBorrador = (prev as { status: string } | null)?.status === "draft";
  }
  const resultado = await registrarCobroSinVerifacti(args);
  if (eraBorrador && resultado.status && resultado.status !== "draft") {
    const { registrarAltaVerifactiSiProcede } = await import(
      "./external-providers/verifacti-envio"
    );
    await registrarAltaVerifactiSiProcede({
      admin,
      companyId: args.companyId,
      invoiceId: args.invoiceId,
      alinearFecha: true,
    });
  }
  return resultado;
}

async function registrarCobroSinVerifacti(
  args: RegistrarCobroArgs,
): Promise<RegistrarCobroResultado> {
  const { admin } = args;
  const { data, error } = await admin.rpc("registrar_cobro_factura", {
    p_company_id: args.companyId,
    p_invoice_id: args.invoiceId,
    p_amount_cents: args.importeCents,
    p_wallet_entry_id: args.walletEntryId ?? null,
    p_user_id: args.usuarioId ?? null,
    p_permitir_borrador: !!args.permitirBorrador,
    p_crear_wallet: !!args.crearWallet,
    p_metodo: args.crearWallet?.metodo ?? "transfer",
    p_notas: args.notas ?? null,
  });
  if (!error) {
    const r = (data ?? {}) as Partial<RegistrarCobroResultado>;
    return {
      payment_id: r.payment_id ?? null,
      wallet_entry_id: r.wallet_entry_id ?? args.walletEntryId ?? null,
      status: r.status ?? "",
      ya_existia: !!r.ya_existia,
    };
  }
  if (!rpcNoExiste(error)) {
    // Errores de negocio de la RPC (P0001) llegan con su mensaje en español.
    throw new Error(error.message ?? "No se pudo registrar el cobro");
  }
  return registrarCobroRespaldo(args);
}

/** Respaldo sin RPC: mismas reglas, sin bloqueo de fila. */
async function registrarCobroRespaldo(
  args: RegistrarCobroArgs,
): Promise<RegistrarCobroResultado> {
  const { admin, companyId, invoiceId } = args;
  const { data: inv, error: invErr } = await admin
    .from("invoices")
    .select("id, kind, status, total_cents, contract_id, customer_id")
    .eq("id", invoiceId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (invErr) throw new Error(invErr.message);
  if (!inv) throw new Error("Factura no encontrada");
  const f = inv as {
    id: string;
    kind: string;
    status: string;
    total_cents: number;
    contract_id: string | null;
    customer_id: string | null;
  };

  if (args.walletEntryId) {
    const { data: ya } = await admin
      .from("invoice_payments")
      .select("id")
      .eq("invoice_id", invoiceId)
      .eq("wallet_entry_id", args.walletEntryId)
      .limit(1)
      .maybeSingle();
    if (ya) {
      return {
        payment_id: (ya as { id: string }).id,
        wallet_entry_id: args.walletEntryId,
        status: f.status,
        ya_existia: true,
      };
    }
  }

  const { data: pays, error: paysErr } = await admin
    .from("invoice_payments")
    .select("amount_cents")
    .eq("invoice_id", invoiceId);
  if (paysErr) throw new Error(paysErr.message);
  const pagado = ((pays ?? []) as Array<{ amount_cents: number }>).reduce(
    (s, p) => s + p.amount_cents,
    0,
  );
  const err = validarCobroFactura({
    kind: f.kind,
    status: f.status,
    total_cents: f.total_cents,
    pagado_cents: pagado,
    importe_cents: args.importeCents,
    permitir_borrador: !!args.permitirBorrador,
  });
  if (err) throw new Error(err);

  const ahora = new Date().toISOString();
  let walletId = args.walletEntryId ?? null;
  if (args.crearWallet) {
    const { data: w, error: wErr } = await admin
      .from("wallet_entries")
      .insert({
        company_id: companyId,
        contract_id: f.contract_id,
        customer_id: f.customer_id,
        invoice_id: invoiceId,
        concept: args.notas ?? "Cobro de factura",
        amount_cents: args.importeCents,
        method: args.crearWallet.metodo,
        status: "validated",
        collected_at: ahora,
        collected_by_user_id: args.usuarioId ?? null,
        validated_at: ahora,
        validated_by_user_id: args.usuarioId ?? null,
      })
      .select("id")
      .single();
    if (wErr) throw new Error(wErr.message);
    walletId = (w as { id: string }).id;
  }

  const { data: p, error: pErr } = await admin
    .from("invoice_payments")
    .insert({
      company_id: companyId,
      invoice_id: invoiceId,
      wallet_entry_id: walletId,
      amount_cents: args.importeCents,
      created_by: args.usuarioId ?? null,
      notes: args.notas ?? null,
    })
    .select("id")
    .single();
  if (pErr) {
    if (args.crearWallet && walletId) {
      await admin.from("wallet_entries").delete().eq("id", walletId);
    }
    throw new Error(pErr.message);
  }

  let status = f.status;
  if (pagado + args.importeCents >= f.total_cents) {
    const upd: Record<string, unknown> = { status: "paid", paid_at: ahora };
    if (f.status === "draft") upd.issued_at = ahora;
    const { error: uErr } = await admin
      .from("invoices")
      .update(upd)
      .eq("id", invoiceId)
      .eq("company_id", companyId);
    if (uErr) throw new Error(uErr.message);
    status = "paid";
  }
  return {
    payment_id: (p as { id: string }).id,
    wallet_entry_id: walletId,
    status,
    ya_existia: false,
  };
}

/**
 * Deshace el cobro de factura respaldado por un wallet (devolución o
 * retrocesión de GoCardless). `invoice_payments` no admite importes
 * negativos, así que se borra el cobro y la factura vuelve a `issued`.
 */
export async function anularCobroDeWallet(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  companyId: string;
  walletEntryId: string;
}): Promise<{ facturas_reabiertas: number }> {
  const { admin, companyId, walletEntryId } = args;
  const { data: pays, error } = await admin
    .from("invoice_payments")
    .select("id, invoice_id")
    .eq("company_id", companyId)
    .eq("wallet_entry_id", walletEntryId);
  if (error) throw new Error(error.message);
  const lista = (pays ?? []) as Array<{ id: string; invoice_id: string }>;
  let reabiertas = 0;
  for (const p of lista) {
    const { error: dErr } = await admin.from("invoice_payments").delete().eq("id", p.id);
    if (dErr) throw new Error(dErr.message);
    const { data: upd, error: uErr } = await admin
      .from("invoices")
      .update({ status: "issued", paid_at: null })
      .eq("id", p.invoice_id)
      .eq("company_id", companyId)
      .eq("status", "paid")
      .select("id");
    if (uErr) throw new Error(uErr.message);
    reabiertas += ((upd ?? []) as unknown[]).length;
  }
  return { facturas_reabiertas: reabiertas };
}
