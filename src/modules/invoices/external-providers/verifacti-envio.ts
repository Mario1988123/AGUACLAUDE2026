import "server-only";

import { madridDateKey } from "@/shared/lib/format-date";
import { descifrarDeBytea } from "./cifrado";
import { VerifactiClient } from "./verifacti";
import {
  claveIdempotencia,
  construirCuerpoAlta,
  construirCuerpoAnulacion,
  type FacturaCrmParaVerifacti,
  type LineaFacturaCrm,
} from "./verifacti-mapeo";

/**
 * REGISTRO EN VERIFACTU A TRAVÉS DE VERIFACTI — camino único (sin sesión;
 * NO es "use server").
 *
 * Lo usan:
 *  · markInvoiceIssuedAction (al emitir un borrador) y registrarCobroFactura
 *    (cuando un cobro automático pasa un borrador a pagada): envío automático.
 *  · Los botones de la ficha de factura (registrar, consultar, anular).
 *  · El cron horario, para consultar los registros que siguen "Pendiente".
 *
 * Independiente de VERIFACTU_HABILITADO (que bloquea el envío DIRECTO a la
 * AEAT con certificado propio). Esta vía solo actúa si la empresa tiene
 * proveedor 'verifacti', API key guardada, la última prueba de conexión
 * correcta y `external_invoicing_activo = true`.
 *
 * Idempotencia (doble clic, reintentos, dos procesos a la vez):
 *  1. Índice único parcial uq_ext_inv_subs_vivo: un solo envío 'sending' o
 *     'sent' por factura y operación (migración 20261003090000).
 *  2. Cabecera Idempotency-Key determinista (factura + operación + hash del
 *     cuerpo): un reintento del mismo envío devuelve la respuesta original.
 *  3. La AEAT/Verifacti rechazan además una segunda alta con la misma serie,
 *     número y fecha (`vf-verifactu-factura_duplicada`).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const PROVEEDOR = "verifacti";
const ENVIO_COLGADO_MS = 5 * 60_000;

export type ResultadoVerifacti =
  | { ok: true; estado: string; mensaje: string; qr_url?: string | null }
  | { ok: false; omitida?: boolean; error: string };

interface ConfigVerifacti {
  apiKey: string;
  entorno: "sandbox" | "production";
}

function errorEsColumnaInexistente(e: { message?: string; code?: string } | null): boolean {
  return !!e && (e.code === "42703" || /column .* does not exist|schema cache/i.test(e.message ?? ""));
}

const MENSAJE_FALTA_MIGRACION =
  "Falta aplicar la migración 20261003090000_verifacti_envio_por_empresa en la base de datos.";

/** Lee y valida la configuración de Verifacti de la empresa. */
export async function leerConfigVerifacti(
  admin: Admin,
  companyId: string,
): Promise<{ ok: true; config: ConfigVerifacti } | { ok: false; activo: boolean; error: string }> {
  const { data, error } = await admin
    .from("company_settings")
    .select(
      `external_invoicing_provider, external_invoicing_environment,
       external_invoicing_api_key_encrypted, external_invoicing_last_test_ok,
       external_invoicing_activo, verifactu_mode`,
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      activo: false,
      error: errorEsColumnaInexistente(error) ? MENSAJE_FALTA_MIGRACION : error.message,
    };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.external_invoicing_provider !== PROVEEDOR) {
    return { ok: false, activo: false, error: "La empresa no tiene Verifacti como proveedor de VeriFactu." };
  }
  if (row.external_invoicing_activo !== true) {
    return {
      ok: false,
      activo: false,
      error: "El registro en VeriFactu con Verifacti no está activado para esta empresa (Configuración → Facturación).",
    };
  }
  if (!row.external_invoicing_api_key_encrypted) {
    return { ok: false, activo: true, error: "Falta la API key de Verifacti (Configuración → Facturación)." };
  }
  if (row.external_invoicing_last_test_ok !== true) {
    return {
      ok: false,
      activo: true,
      error: "La última prueba de conexión con Verifacti no fue correcta. Pruébala de nuevo en Configuración → Facturación.",
    };
  }
  if (row.verifactu_mode && row.verifactu_mode !== "no_envio") {
    return {
      ok: false,
      activo: true,
      error: "La empresa tiene activado además el envío directo a la AEAT. Desactívalo para no registrar dos veces.",
    };
  }
  let apiKey: string;
  try {
    apiKey = descifrarDeBytea(row.external_invoicing_api_key_encrypted);
  } catch {
    return {
      ok: false,
      activo: true,
      error: "No se pudo descifrar la API key de Verifacti. Vuelve a pegarla en Configuración → Facturación.",
    };
  }
  return {
    ok: true,
    config: {
      apiKey,
      entorno: row.external_invoicing_environment === "production" ? "production" : "sandbox",
    },
  };
}

interface FacturaCargada {
  id: string;
  kind: string;
  status: string;
  issue_date: string;
  full_reference: string;
  datos: FacturaCrmParaVerifacti;
}

function nombreCliente(snap: Record<string, unknown>): string {
  const empresa =
    snap.party_kind === "company" || (!snap.first_name && !snap.last_name);
  if (empresa) {
    return String(snap.legal_name || snap.trade_name || snap.name || "").trim();
  }
  return `${snap.first_name ?? ""} ${snap.last_name ?? ""}`.trim();
}

async function cargarFactura(
  admin: Admin,
  companyId: string,
  invoiceId: string,
): Promise<FacturaCargada | null> {
  const { data: inv } = await admin
    .from("invoices")
    .select(
      `id, company_id, kind, status, full_reference, issue_date, is_simplified,
       description, notes, subtotal_cents, tax_cents, corrects_invoice_id,
       customer_fiscal_snapshot, customer_snapshot`,
    )
    .eq("id", invoiceId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!inv) return null;
  const f = inv as Record<string, unknown>;
  const snap = ((f.customer_fiscal_snapshot ?? f.customer_snapshot ?? {}) as Record<string, unknown>);
  const addr = (snap.address ?? {}) as Record<string, unknown>;

  const { data: lineas } = await admin
    .from("invoice_lines")
    .select(
      "description, subtotal_cents, tax_cents, tax_rate_percent, is_exempt, exempt_reason, is_reverse_charge",
    )
    .eq("invoice_id", invoiceId)
    .order("display_order", { ascending: true });

  let rectificada: FacturaCrmParaVerifacti["rectificada"] = null;
  if (f.corrects_invoice_id) {
    const { data: o } = await admin
      .from("invoices")
      .select("full_reference, issue_date")
      .eq("id", f.corrects_invoice_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (o) rectificada = o as { full_reference: string; issue_date: string };
  }

  return {
    id: String(f.id),
    kind: String(f.kind),
    status: String(f.status),
    issue_date: String(f.issue_date),
    full_reference: String(f.full_reference),
    datos: {
      kind: f.kind as "invoice" | "credit_note",
      full_reference: String(f.full_reference),
      issue_date: String(f.issue_date),
      is_simplified: (f.is_simplified as boolean | null) ?? false,
      description: (f.description as string | null) ?? null,
      notes: (f.notes as string | null) ?? null,
      subtotal_cents: Number(f.subtotal_cents ?? 0),
      tax_cents: Number(f.tax_cents ?? 0),
      cliente: {
        nombre: nombreCliente(snap),
        nif: (snap.tax_id as string | null) ?? null,
        pais: (addr.country as string | null) ?? (snap.country as string | null) ?? "ES",
      },
      lineas: ((lineas ?? []) as Array<Record<string, unknown>>).map(
        (l): LineaFacturaCrm => ({
          description: String(l.description ?? ""),
          subtotal_cents: Number(l.subtotal_cents ?? 0),
          tax_cents: Number(l.tax_cents ?? 0),
          tax_rate_percent: Number(l.tax_rate_percent ?? 0),
          is_exempt: (l.is_exempt as boolean | null) ?? false,
          exempt_reason: (l.exempt_reason as string | null) ?? null,
          is_reverse_charge: (l.is_reverse_charge as boolean | null) ?? false,
        }),
      ),
      rectificada,
    },
  };
}

/** Envío vivo (sending/sent) de una factura y operación, si lo hay. */
async function envioVivo(
  admin: Admin,
  invoiceId: string,
  operacion: "alta" | "anulacion",
): Promise<{ id: string; status: string; estado_aeat: string | null; updated_at: string; qr_url: string | null } | null> {
  const { data, error } = await admin
    .from("external_invoicing_submissions")
    .select("id, status, estado_aeat, updated_at, qr_url")
    .eq("invoice_id", invoiceId)
    .eq("provider", PROVEEDOR)
    .eq("operacion", operacion)
    .in("status", ["sending", "sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(errorEsColumnaInexistente(error) ? MENSAJE_FALTA_MIGRACION : error.message);
  return data ?? null;
}

/**
 * Reserva el hueco de envío. Si hay un 'sending' colgado (> 5 min, p. ej. la
 * función murió a mitad), se marca fallido para poder reintentar: la
 * Idempotency-Key hace que Verifacti devuelva la respuesta original si la
 * primera llamada sí llegó.
 */
async function reservarEnvio(
  admin: Admin,
  args: {
    companyId: string;
    invoiceId: string;
    operacion: "alta" | "anulacion";
    clave: string;
    cuerpo: unknown;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const vivo = await envioVivo(admin, args.invoiceId, args.operacion);
  if (vivo?.status === "sending") {
    const edad = Date.now() - new Date(vivo.updated_at).getTime();
    if (edad < ENVIO_COLGADO_MS) {
      return { ok: false, error: "Esta factura ya se está enviando a Verifacti. Espera unos segundos." };
    }
    await admin
      .from("external_invoicing_submissions")
      .update({
        status: "failed",
        error_code: "INTERRUMPIDO",
        error_message: "El envío anterior se interrumpió sin respuesta.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", vivo.id)
      .eq("status", "sending");
  }
  const { count } = await admin
    .from("external_invoicing_submissions")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", args.invoiceId)
    .eq("provider", PROVEEDOR)
    .eq("operacion", args.operacion);
  const { data, error } = await admin
    .from("external_invoicing_submissions")
    .insert({
      company_id: args.companyId,
      invoice_id: args.invoiceId,
      provider: PROVEEDOR,
      operacion: args.operacion,
      status: "sending",
      attempt_number: (count ?? 0) + 1,
      idempotency_key: args.clave,
      request_payload: args.cuerpo,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Esta factura ya se está enviando o ya está registrada en VeriFactu." };
    }
    return { ok: false, error: errorEsColumnaInexistente(error) ? MENSAJE_FALTA_MIGRACION : error.message };
  }
  return { ok: true, id: (data as { id: string }).id };
}

async function anotarFalloSinEnvio(
  admin: Admin,
  args: { companyId: string; invoiceId: string; operacion: "alta" | "anulacion"; error: string },
): Promise<void> {
  // Deja rastro en la ficha de la factura de por qué no se registró.
  await admin.from("external_invoicing_submissions").insert({
    company_id: args.companyId,
    invoice_id: args.invoiceId,
    provider: PROVEEDOR,
    operacion: args.operacion,
    status: "failed",
    error_code: "VALIDACION_CRM",
    error_message: args.error,
  });
}

/**
 * Registra (alta) una factura emitida en VeriFactu a través de Verifacti.
 *
 * @param alinearFecha  true solo cuando la factura ACABA de pasar de
 *   borrador a emitida/pagada: entonces su fecha de expedición pasa a ser
 *   hoy (Verifacti solo acepta la fecha actual). Nunca se cambia la fecha de
 *   una factura que ya tuvo algún envío.
 * @param soloSiActiva  true en los envíos automáticos: si la empresa no
 *   tiene Verifacti activo no hace nada ni deja rastro.
 */
export async function registrarAltaVerifacti(args: {
  admin: Admin;
  companyId: string;
  invoiceId: string;
  alinearFecha?: boolean;
  soloSiActiva?: boolean;
}): Promise<ResultadoVerifacti> {
  const { admin, companyId, invoiceId } = args;
  const cfg = await leerConfigVerifacti(admin, companyId);
  if (!cfg.ok) {
    if (args.soloSiActiva && !cfg.activo) return { ok: false, omitida: true, error: cfg.error };
    return { ok: false, error: cfg.error };
  }

  let factura = await cargarFactura(admin, companyId, invoiceId);
  if (!factura) return { ok: false, error: "Factura no encontrada." };
  if (factura.kind !== "invoice" && factura.kind !== "credit_note") {
    return { ok: false, omitida: true, error: "Solo se registran facturas y rectificativas." };
  }
  if (!["issued", "paid", "overdue"].includes(factura.status)) {
    return {
      ok: false,
      omitida: factura.status === "draft",
      error: "Solo se registran en VeriFactu facturas emitidas (no borradores ni anuladas).",
    };
  }

  const vivo = await envioVivo(admin, invoiceId, "alta");
  if (vivo?.status === "sent") {
    return {
      ok: true,
      estado: vivo.estado_aeat ?? "Pendiente",
      mensaje: "La factura ya estaba registrada en VeriFactu.",
      qr_url: vivo.qr_url,
    };
  }

  const hoy = madridDateKey(new Date());
  if (args.alinearFecha && factura.issue_date !== hoy) {
    const { count } = await admin
      .from("external_invoicing_submissions")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", invoiceId)
      .eq("provider", PROVEEDOR);
    if (!count) {
      await admin
        .from("invoices")
        .update({ issue_date: hoy })
        .eq("id", invoiceId)
        .eq("company_id", companyId)
        .neq("status", "draft");
      factura = (await cargarFactura(admin, companyId, invoiceId)) ?? factura;
    }
  }

  const mapeo = construirCuerpoAlta(factura.datos, hoy);
  if (!mapeo.ok) {
    await anotarFalloSinEnvio(admin, { companyId, invoiceId, operacion: "alta", error: mapeo.error });
    return { ok: false, error: mapeo.error };
  }
  const cuerpo = mapeo.cuerpo;
  const clave = claveIdempotencia("alta", invoiceId, cuerpo);

  const reserva = await reservarEnvio(admin, { companyId, invoiceId, operacion: "alta", clave, cuerpo });
  if (!reserva.ok) return { ok: false, error: reserva.error };

  const cliente = new VerifactiClient();
  const r = await cliente.crear(cfg.config.apiKey, cuerpo, clave);
  const ahora = new Date().toISOString();

  if (!r.ok) {
    await admin
      .from("external_invoicing_submissions")
      .update({
        status: "failed",
        response_payload: r.raw ?? null,
        error_code: r.codigo,
        error_message: r.mensaje,
        updated_at: ahora,
      })
      .eq("id", reserva.id);
    return { ok: false, error: r.mensaje };
  }

  const d = r.datos;
  await admin
    .from("external_invoicing_submissions")
    .update({
      status: "sent",
      sent_at: ahora,
      external_id: d.uuid ?? null,
      estado_aeat: d.estado ?? "Pendiente",
      huella: d.huella ?? null,
      qr_url: d.url ?? null,
      // El PNG del QR en base64 no se guarda: se regenera desde la URL.
      response_payload: { uuid: d.uuid, estado: d.estado, url: d.url, huella: d.huella, repetida: r.repetida },
      error_code: null,
      error_message: null,
      updated_at: ahora,
    })
    .eq("id", reserva.id);

  await admin
    .from("invoices")
    .update({
      verifactu_qr_url: d.url ?? null,
      verifactu_hash: d.huella ?? null,
      verifactu_submitted_at: ahora,
    })
    .eq("id", invoiceId)
    .eq("company_id", companyId);

  return {
    ok: true,
    estado: d.estado ?? "Pendiente",
    mensaje:
      cfg.config.entorno === "production"
        ? "Factura registrada en VeriFactu. La AEAT la procesa en aproximadamente un minuto."
        : "Factura enviada al entorno de PRUEBAS de VeriFactu (no tiene validez fiscal).",
    qr_url: d.url ?? null,
  };
}

/** Envío automático tras emitir: nunca lanza; registra el error en consola. */
export async function registrarAltaVerifactiSiProcede(args: {
  admin: Admin;
  companyId: string;
  invoiceId: string;
  alinearFecha: boolean;
}): Promise<void> {
  try {
    const r = await registrarAltaVerifacti({ ...args, soloSiActiva: true });
    if (!r.ok && !r.omitida) {
      console.error(`[verifacti] alta de ${args.invoiceId} no registrada: ${r.error}`);
    }
  } catch (e) {
    console.error(`[verifacti] alta de ${args.invoiceId} falló:`, e);
  }
}

/**
 * Anula en VeriFactu el registro de una factura (POST /verifactu/cancel).
 * Solo para registros que la AEAT aceptó. Ojo: una factura anulada en
 * VeriFactu no se puede volver a dar de alta con la misma serie, número y
 * fecha. Para corregir importes lo correcto es una rectificativa.
 */
export async function anularRegistroVerifacti(args: {
  admin: Admin;
  companyId: string;
  invoiceId: string;
}): Promise<ResultadoVerifacti> {
  const { admin, companyId, invoiceId } = args;
  const cfg = await leerConfigVerifacti(admin, companyId);
  if (!cfg.ok) return { ok: false, error: cfg.error };
  const factura = await cargarFactura(admin, companyId, invoiceId);
  if (!factura) return { ok: false, error: "Factura no encontrada." };

  const alta = await envioVivo(admin, invoiceId, "alta");
  if (!alta || alta.status !== "sent") {
    return { ok: false, error: "Esta factura no consta registrada en VeriFactu: no hay nada que anular." };
  }
  if (!["Correcto", "Aceptado con errores"].includes(alta.estado_aeat ?? "")) {
    return {
      ok: false,
      error: `El registro está en estado «${alta.estado_aeat ?? "desconocido"}». Solo se anulan registros aceptados por la AEAT; consulta antes su estado.`,
    };
  }
  const yaAnulada = await envioVivo(admin, invoiceId, "anulacion");
  if (yaAnulada) {
    return { ok: true, estado: yaAnulada.estado_aeat ?? "Pendiente", mensaje: "La anulación ya se había enviado." };
  }

  const cuerpo = construirCuerpoAnulacion(factura);
  const clave = claveIdempotencia("anulacion", invoiceId, cuerpo);
  const reserva = await reservarEnvio(admin, { companyId, invoiceId, operacion: "anulacion", clave, cuerpo });
  if (!reserva.ok) return { ok: false, error: reserva.error };

  const r = await new VerifactiClient().anular(cfg.config.apiKey, cuerpo, clave);
  const ahora = new Date().toISOString();
  if (!r.ok) {
    await admin
      .from("external_invoicing_submissions")
      .update({
        status: "failed",
        response_payload: r.raw ?? null,
        error_code: r.codigo,
        error_message: r.mensaje,
        updated_at: ahora,
      })
      .eq("id", reserva.id);
    return { ok: false, error: r.mensaje };
  }
  await admin
    .from("external_invoicing_submissions")
    .update({
      status: "sent",
      sent_at: ahora,
      external_id: r.datos.uuid ?? null,
      estado_aeat: r.datos.estado ?? "Pendiente",
      huella: r.datos.huella ?? null,
      response_payload: r.raw ?? null,
      updated_at: ahora,
    })
    .eq("id", reserva.id);
  return { ok: true, estado: r.datos.estado ?? "Pendiente", mensaje: "Anulación enviada a VeriFactu." };
}

/** Consulta en Verifacti el estado de un envío y lo guarda. */
export async function consultarEstadoEnvioVerifacti(args: {
  admin: Admin;
  companyId: string;
  submissionId: string;
  apiKey?: string;
}): Promise<ResultadoVerifacti> {
  const { admin, companyId, submissionId } = args;
  const { data: sub } = await admin
    .from("external_invoicing_submissions")
    .select("id, external_id, status")
    .eq("id", submissionId)
    .eq("company_id", companyId)
    .eq("provider", PROVEEDOR)
    .maybeSingle();
  const s = sub as { id: string; external_id: string | null; status: string } | null;
  if (!s?.external_id || s.status !== "sent") {
    return { ok: false, error: "Ese envío no llegó a Verifacti: no hay estado que consultar." };
  }
  let apiKey = args.apiKey;
  if (!apiKey) {
    const cfg = await leerConfigVerifacti(admin, companyId);
    if (!cfg.ok) return { ok: false, error: cfg.error };
    apiKey = cfg.config.apiKey;
  }
  const r = await new VerifactiClient().estadoRegistro(apiKey, s.external_id);
  if (!r.ok) return { ok: false, error: r.mensaje };
  const d = r.datos;
  await admin
    .from("external_invoicing_submissions")
    .update({
      estado_aeat: d.estado ?? null,
      codigo_error_aeat: d.codigo_error ?? null,
      mensaje_error_aeat: d.mensaje_error ?? null,
      estado_consultado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", s.id);
  const estado = d.estado ?? "desconocido";
  const conError = d.codigo_error || d.mensaje_error;
  return {
    ok: true,
    estado,
    mensaje: conError
      ? `Estado en la AEAT: ${estado}. ${d.codigo_error ?? ""} ${d.mensaje_error ?? ""}`.trim()
      : `Estado en la AEAT: ${estado}.`,
  };
}

/** Cron: refresca los registros que siguen "Pendiente" (máx. `limite`). */
export async function actualizarEstadosPendientesVerifacti(
  admin: Admin,
  limite = 50,
): Promise<{ consultados: number; errores: number }> {
  const { data, error } = await admin
    .from("external_invoicing_submissions")
    .select("id, company_id")
    .eq("provider", PROVEEDOR)
    .eq("status", "sent")
    .or('estado_aeat.is.null,estado_aeat.in.(Pendiente,"Error servidor AEAT")')
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) {
    // Sin migración aplicada no hay nada que consultar.
    if (errorEsColumnaInexistente(error)) return { consultados: 0, errores: 0 };
    throw new Error(error.message);
  }
  const filas = (data ?? []) as Array<{ id: string; company_id: string }>;
  const claves = new Map<string, string | null>();
  let consultados = 0;
  let errores = 0;
  for (const f of filas) {
    if (!claves.has(f.company_id)) {
      const cfg = await leerConfigVerifacti(admin, f.company_id);
      claves.set(f.company_id, cfg.ok ? cfg.config.apiKey : null);
    }
    const apiKey = claves.get(f.company_id);
    if (!apiKey) continue;
    const r = await consultarEstadoEnvioVerifacti({
      admin,
      companyId: f.company_id,
      submissionId: f.id,
      apiKey,
    });
    if (r.ok) consultados++;
    else errores++;
  }
  return { consultados, errores };
}
