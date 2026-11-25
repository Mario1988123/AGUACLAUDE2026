import "server-only";
import { admin } from "./servidor";
import { aplanarCarga, traducirEstadoPlantilla, type CargaMeta, type EventoPlano } from "./logica";

/**
 * Entrada del webhook de WhatsApp (fase 1).
 *
 * Guarda cada cambio en captacion_webhook_eventos (una vez: clave_dedupe
 * única) con la empresa resuelta por phone_number_id o por waba_id, y procesa
 * en el momento lo que es barato y no manda nada a nadie:
 *  · message_template_status_update → estado de la plantilla
 *  · account_update con baja o restricción → apaga los envíos
 * Los mensajes y estados se quedan con procesado_at nulo: los recogerá la
 * bandeja en la fase 2.
 */

interface Conexion {
  company_id: string;
  waba_id: string | null;
  phone_number_id: string | null;
}

/** Eventos de account_update que cortan la conexión. */
const BAJAS = new Set([
  "ACCOUNT_DELETED",
  "ACCOUNT_OFFBOARDED",
  "PARTNER_REMOVED",
  "PARTNER_APP_UNINSTALLED",
]);
/** Eventos que dejan la cuenta suspendida hasta que lo mire una persona. */
const RESTRICCIONES = new Set(["ACCOUNT_RESTRICTION", "ACCOUNT_VIOLATION", "DISABLED_UPDATE"]);

async function resolverConexiones(eventos: EventoPlano[]): Promise<Conexion[]> {
  const pnids = [...new Set(eventos.map((e) => e.phoneNumberId).filter(Boolean))] as string[];
  const wabas = [...new Set(eventos.map((e) => e.wabaId).filter(Boolean))] as string[];
  if (pnids.length === 0 && wabas.length === 0) return [];
  const filtros: string[] = [];
  if (pnids.length) filtros.push(`phone_number_id.in.(${pnids.map((v) => `"${v}"`).join(",")})`);
  if (wabas.length) filtros.push(`waba_id.in.(${wabas.map((v) => `"${v}"`).join(",")})`);
  const { data, error } = await admin()
    .from("captacion_conexiones")
    .select("company_id, waba_id, phone_number_id")
    .or(filtros.join(","));
  if (error) throw new Error(`No se pudo resolver la empresa: ${error.message}`);
  return (data ?? []) as Conexion[];
}

function empresaDe(e: EventoPlano, conexiones: Conexion[]): string | null {
  if (e.phoneNumberId) {
    const c = conexiones.find((x) => x.phone_number_id === e.phoneNumberId);
    if (c) return c.company_id;
  }
  if (e.wabaId) {
    const c = conexiones.find((x) => x.waba_id === e.wabaId);
    if (c) return c.company_id;
  }
  return null;
}

/** Solo admite ids numéricos de Meta en los filtros (van dentro de un .or()). */
function idSeguro(v: string | null): string | null {
  return v && /^\d{1,30}$/.test(v) ? v : null;
}

export async function registrarCarga(carga: CargaMeta): Promise<{ guardados: number; sinEmpresa: number }> {
  const eventos = aplanarCarga(carga).map((e) => ({
    ...e,
    phoneNumberId: idSeguro(e.phoneNumberId),
    wabaId: idSeguro(e.wabaId),
  }));
  if (eventos.length === 0) return { guardados: 0, sinEmpresa: 0 };

  const conexiones = await resolverConexiones(eventos);
  const db = admin();
  let guardados = 0;
  let sinEmpresa = 0;
  const empresasVistas = new Set<string>();

  for (const e of eventos) {
    const companyId = empresaDe(e, conexiones);
    if (!companyId) sinEmpresa++;
    else empresasVistas.add(companyId);

    const { data, error } = await db
      .from("captacion_webhook_eventos")
      .upsert(
        {
          company_id: companyId,
          phone_number_id: e.phoneNumberId,
          waba_id: e.wabaId,
          campo: e.campo,
          clave_dedupe: e.claveDedupe,
          cuerpo: e.cuerpo,
        },
        { onConflict: "clave_dedupe", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(`No se pudo guardar el evento: ${error.message}`);
    const nuevo = ((data ?? []) as Array<{ id: string }>)[0];
    if (!nuevo) continue; // duplicado: ya estaba
    guardados++;

    if (companyId) {
      try {
        const procesado = await procesarEnElMomento(companyId, e);
        if (procesado) {
          await db
            .from("captacion_webhook_eventos")
            .update({ procesado_at: new Date().toISOString(), intentos: 1 })
            .eq("id", nuevo.id);
        }
      } catch (err) {
        await db
          .from("captacion_webhook_eventos")
          .update({ error: err instanceof Error ? err.message.slice(0, 500) : "error", intentos: 1 })
          .eq("id", nuevo.id);
      }
    }
  }

  if (empresasVistas.size > 0) {
    await db
      .from("captacion_conexiones")
      .update({ ultimo_webhook_at: new Date().toISOString() })
      .in("company_id", [...empresasVistas]);
  }

  return { guardados, sinEmpresa };
}

/** Devuelve true si el evento queda resuelto del todo. */
async function procesarEnElMomento(companyId: string, e: EventoPlano): Promise<boolean> {
  const v = (e.cuerpo.value ?? {}) as Record<string, unknown>;
  const db = admin();

  if (e.campo === "message_template_status_update") {
    const evento = typeof v.event === "string" ? v.event : null;
    const nombre = typeof v.message_template_name === "string" ? v.message_template_name : null;
    const idioma = typeof v.message_template_language === "string" ? v.message_template_language : null;
    const metaId = v.message_template_id != null ? String(v.message_template_id) : null;
    if (!evento || (!metaId && !(nombre && idioma))) return false;
    const motivo = typeof v.reason === "string" && v.reason !== "NONE" ? v.reason : null;
    let q = db
      .from("captacion_plantillas")
      .update({ estado: traducirEstadoPlantilla(evento), estado_meta: evento, motivo_rechazo: motivo })
      .eq("company_id", companyId);
    q = metaId ? q.eq("meta_template_id", metaId) : q.eq("nombre", nombre).eq("idioma", idioma);
    const { error } = await q;
    if (error) throw new Error(error.message);
    // Si la plantilla no estaba sincronizada aún, la sincronización diaria la traerá.
    return true;
  }

  if (e.campo === "account_update") {
    const evento = typeof v.event === "string" ? v.event.toUpperCase() : "";
    if (BAJAS.has(evento)) {
      const { error } = await db
        .from("captacion_conexiones")
        .update({ estado: "desconectada", envios_activos: false, ultimo_error: `Meta: ${evento}` })
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return true;
    }
    if (RESTRICCIONES.has(evento)) {
      const { error } = await db
        .from("captacion_conexiones")
        .update({ estado: "suspendida", envios_activos: false, ultimo_error: `Meta: ${evento}` })
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return true;
    }
    // El resto (PARTNER_ADDED, ACCOUNT_RECONNECTED…) se guarda sin tocar nada:
    // volver a encender algo lo decide una persona.
    return true;
  }

  return false;
}
