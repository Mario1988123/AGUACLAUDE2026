import "server-only";
import { randomUUID } from "node:crypto";
import { empresasEnServicio } from "@/shared/lib/empresas/en-servicio";
import { enviosEnFrioPermitidos } from "./guard";
import { admin, obtenerToken } from "./servidor";
import { enviarPlantilla, ErrorMeta } from "./meta";
import { conversacionPara } from "./bandeja-servidor";
import type { EstadoNormalizado } from "./bandeja-logica";
import {
  analizarPlantilla,
  cargaBoton,
  ERROR_SIN_WHATSAPP,
  errorCortaTanda,
  estadosEnvioAnteriores,
  leerEscalado,
  leerHorario,
  minutosRestantesHorario,
  parametroNombre,
  plantillaSirveParaCaptacion,
  presupuestoEmpresa,
  renderizarCuerpo,
  topeCampanaHoy,
  trozoDePasada,
  type UsoPlantilla,
} from "./envios-logica";
import { costeEnvio, diasEscalado, extraerPreciosEstados, milicentimosACents } from "./mando-logica";
import { aplicarCortacircuitos, controlarGasto, revisarConexiones } from "./mando-servidor";

/**
 * Envío de tanda con tope (plan §4.3, fase 3). Lo llama el cron
 * captacion-envios cada 10 minutos. Nada sale si falla cualquiera de las tres
 * llaves de enviosEnFrioPermitidos (módulo, conexión con envios_activos y
 * CAPTACION_ENVIOS_ACTIVOS=1).
 *
 * Todo con el cliente de servicio y con company_id explícito en cada filtro.
 */

const DIA_MS = 86_400_000;
/** A los 7 días del recordatorio sin respuesta no se le escribe más (§4.7.4). */
const DIAS_SIN_RESPUESTA = 7;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface PlantillaFila {
  id: string;
  nombre: string;
  idioma: string;
  estado: string;
  uso: UsoPlantilla | "documento" | null;
  componentes: unknown;
}

interface CampanaFila {
  id: string;
  nombre: string;
  estado: string;
  plantilla_primer_contacto_id: string | null;
  plantilla_recordatorio_id: string | null;
  recordatorio_dias: number;
  tope_diario: number;
  escalado: unknown;
  lanzada_at: string | null;
  /** Reanudada a mano tras una pausa automática (fase 7). */
  reanudada_at: string | null;
  horario: unknown;
}

interface EnvioFila {
  id: string;
  company_id: string;
  prospecto_id: string;
  campana_id: string | null;
  tipo: UsoPlantilla;
}

interface ProspectoEnvio {
  id: string;
  nombre_negocio: string;
  telefono_e164: string | null;
  bsuid: string | null;
  etapa: string;
  codigo_postal: string | null;
  cliente_coincidente_id: string | null;
  lead_coincidente_id: string | null;
}

export interface ResumenEnvios {
  empresas: number;
  enviados: number;
  fallidos: number;
  cancelados: number;
  colgados: number;
  recordatoriosEncolados: number;
  sinRespuesta: number;
  /** Fase 7: campañas pausadas por la conexión o la calidad, y por el cortacircuitos. */
  pausadasConexion: number;
  cortacircuitos: number;
  motivos: string[];
  errores: string[];
}

// -----------------------------------------------------------------------------
// Utilidades compartidas con las respuestas y las acciones
// -----------------------------------------------------------------------------

/** ¿Está bloqueado ese teléfono o ese BSUID (captación o agente de voz)? */
export async function contactoBloqueado(
  companyId: string,
  telefono: string | null,
  bsuid: string | null,
): Promise<boolean> {
  const db = admin();
  const consultas: Array<Promise<{ data: unknown[] | null; error: { message: string } | null }>> = [];
  if (telefono) {
    consultas.push(
      db.from("captacion_bloqueos").select("id").eq("company_id", companyId).eq("ambito", "telefono").eq("valor", telefono).limit(1),
      db.from("voice_do_not_call").select("id").eq("company_id", companyId).eq("phone_e164", telefono).limit(1),
    );
  }
  if (bsuid) {
    consultas.push(
      db.from("captacion_bloqueos").select("id").eq("company_id", companyId).eq("ambito", "bsuid").eq("valor", bsuid).limit(1),
    );
  }
  if (consultas.length === 0) return false;
  const res = await Promise.all(consultas);
  // Si no se puede comprobar, se da por bloqueado: mejor no enviar.
  if (res.some((r) => r.error)) return true;
  return res.some((r) => (r.data ?? []).length > 0);
}

/** Cancela los envíos que aún no han salido de un prospecto. */
export async function cancelarEnviosPendientes(
  companyId: string,
  prospectoId: string,
  motivo: string,
  tipos: UsoPlantilla[] = ["primer_contacto", "recordatorio"],
): Promise<void> {
  const { error } = await admin()
    .from("captacion_envios")
    .update({ estado: "cancelado", cancelado_motivo: motivo, token_reclamo: null })
    .eq("company_id", companyId)
    .eq("prospecto_id", prospectoId)
    .in("tipo", tipos)
    .eq("estado", "en_cola");
  if (error) throw new Error(`No se pudieron cancelar los envíos: ${error.message}`);
}

/**
 * Plantilla con la que sale un envío: la que tenga la campaña o, si no, la
 * aprobada de la empresa con ese uso. Solo si sirve para captación.
 */
export function elegirPlantilla(
  plantillas: PlantillaFila[],
  idCampana: string | null,
  uso: UsoPlantilla,
): PlantillaFila | null {
  const valida = (p: PlantillaFila | undefined) =>
    p && p.estado === "aprobada" && plantillaSirveParaCaptacion(analizarPlantilla(p.componentes)).ok ? p : null;
  if (idCampana) {
    const p = valida(plantillas.find((x) => x.id === idCampana));
    if (p) return p;
  }
  return valida(plantillas.find((x) => x.uso === uso)) ?? null;
}

function digitos(e164: string | null): string | null {
  return e164 ? e164.replace(/^\+/, "") : null;
}

// -----------------------------------------------------------------------------
// Cola
// -----------------------------------------------------------------------------

/**
 * Mete en cola los prospectos `nuevo` de la campaña que se pueden contactar
 * (móvil o WhatsApp comprobado) y no están bloqueados. No envía nada: lo hace
 * el cron con sus controles. (prospecto_id, tipo) único: repetir no duplica.
 */
export async function encolarProspectos(
  companyId: string,
  campanaId: string,
  userId: string,
  limite = 500,
): Promise<{ encolados: number; bloqueados: number }> {
  const db = admin();
  const { data, error } = await db
    .from("captacion_prospectos")
    .select("id, telefono_e164, bsuid, es_movil, telefono_fuente")
    .eq("company_id", companyId)
    .eq("campana_id", campanaId)
    .eq("etapa", "nuevo")
    .not("telefono_e164", "is", null)
    .order("prioridad", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  const filas = ((data ?? []) as Array<{
    id: string;
    telefono_e164: string;
    bsuid: string | null;
    es_movil: boolean | null;
    telefono_fuente: string | null;
  }>).filter((p) => p.es_movil === true || p.telefono_fuente === "whatsapp_web");
  if (filas.length === 0) return { encolados: 0, bloqueados: 0 };

  // Bloqueos y lista del agente de voz, por tandas (la URL tiene límite).
  const vetados = new Set<string>();
  for (let i = 0; i < filas.length; i += 100) {
    const tels = filas.slice(i, i + 100).map((p) => p.telefono_e164);
    const [{ data: b, error: e1 }, { data: d, error: e2 }] = await Promise.all([
      db.from("captacion_bloqueos").select("valor").eq("company_id", companyId).eq("ambito", "telefono").in("valor", tels),
      db.from("voice_do_not_call").select("phone_e164").eq("company_id", companyId).in("phone_e164", tels),
    ]);
    if (e1 || e2) throw new Error(`No se pudieron comprobar los bloqueos: ${(e1 ?? e2).message}`);
    for (const x of (b ?? []) as Array<{ valor: string }>) vetados.add(x.valor);
    for (const x of (d ?? []) as Array<{ phone_e164: string }>) vetados.add(x.phone_e164);
  }

  const bloqueados = filas.filter((p) => vetados.has(p.telefono_e164));
  const aptos = filas.filter((p) => !vetados.has(p.telefono_e164));

  if (bloqueados.length > 0) {
    await db
      .from("captacion_prospectos")
      .update({ etapa: "descartado", descartado_motivo: "Está en la lista de bloqueo" })
      .eq("company_id", companyId)
      .in("id", bloqueados.map((p) => p.id))
      .eq("etapa", "nuevo");
  }

  let encolados = 0;
  for (let i = 0; i < aptos.length; i += 200) {
    const trozo = aptos.slice(i, i + 200);
    const { data: ins, error: eIns } = await db
      .from("captacion_envios")
      .upsert(
        trozo.map((p) => ({
          company_id: companyId,
          prospecto_id: p.id,
          campana_id: campanaId,
          tipo: "primer_contacto",
          estado: "en_cola",
          programado_at: new Date().toISOString(),
          created_by: userId,
        })),
        { onConflict: "prospecto_id,tipo", ignoreDuplicates: true },
      )
      .select("prospecto_id");
    if (eIns) throw new Error(`No se pudo encolar: ${eIns.message}`);
    const nuevos = ((ins ?? []) as Array<{ prospecto_id: string }>).map((x) => x.prospecto_id);
    // Todos los del trozo pasan a «en_cola»: los que ya tenían envío también
    // (si no, se quedarían en «nuevo» para siempre).
    const { error: eUpd } = await db
      .from("captacion_prospectos")
      .update({ etapa: "en_cola" })
      .eq("company_id", companyId)
      .in("id", trozo.map((p) => p.id))
      .eq("etapa", "nuevo");
    if (eUpd) throw new Error(eUpd.message);
    encolados += nuevos.length;
  }
  return { encolados, bloqueados: bloqueados.length };
}

/** Recordatorios que tocan (§4.7): primer contacto entregado o leído hace N días y sin respuesta. */
async function encolarRecordatorios(companyId: string, c: CampanaFila, ahora: Date): Promise<number> {
  const db = admin();
  const limite = new Date(ahora.getTime() - c.recordatorio_dias * DIA_MS).toISOString();
  const { data, error } = await db
    .from("captacion_envios")
    .select("prospecto_id, captacion_prospectos!inner(etapa)")
    .eq("company_id", companyId)
    .eq("campana_id", c.id)
    .eq("tipo", "primer_contacto")
    .in("estado", ["entregado", "leido"])
    .lte("enviado_at", limite)
    // «contactado» = no ha contestado nada: cualquier respuesta cambia la etapa.
    .eq("captacion_prospectos.etapa", "contactado")
    .order("enviado_at")
    .limit(200);
  if (error) throw new Error(`Recordatorios: ${error.message}`);
  const ids = ((data ?? []) as Array<{ prospecto_id: string }>).map((x) => x.prospecto_id);
  if (ids.length === 0) return 0;
  const { data: ins, error: eIns } = await db
    .from("captacion_envios")
    .upsert(
      ids.map((prospecto_id) => ({
        company_id: companyId,
        prospecto_id,
        campana_id: c.id,
        tipo: "recordatorio",
        estado: "en_cola",
        programado_at: ahora.toISOString(),
      })),
      { onConflict: "prospecto_id,tipo", ignoreDuplicates: true },
    )
    .select("id");
  if (eIns) throw new Error(`Recordatorios: ${eIns.message}`);
  return ((ins ?? []) as unknown[]).length;
}

/** A los 7 días del recordatorio sin respuesta: `sin_respuesta` (§4.7.4). */
async function marcarSinRespuesta(companyId: string, ahora: Date): Promise<number> {
  const db = admin();
  const limite = new Date(ahora.getTime() - DIAS_SIN_RESPUESTA * DIA_MS).toISOString();
  const { data, error } = await db
    .from("captacion_envios")
    .select("prospecto_id, captacion_prospectos!inner(etapa)")
    .eq("company_id", companyId)
    .eq("tipo", "recordatorio")
    .in("estado", ["enviado", "entregado", "leido"])
    .lte("enviado_at", limite)
    .eq("captacion_prospectos.etapa", "recordado")
    .limit(500);
  if (error) throw new Error(`Sin respuesta: ${error.message}`);
  const ids = ((data ?? []) as Array<{ prospecto_id: string }>).map((x) => x.prospecto_id);
  let n = 0;
  if (ids.length > 0) {
    const { data: upd, error: e2 } = await db
      .from("captacion_prospectos")
      .update({ etapa: "sin_respuesta" })
      .eq("company_id", companyId)
      .in("id", ids)
      .eq("etapa", "recordado")
      .select("id");
    if (e2) throw new Error(e2.message);
    n = ((upd ?? []) as unknown[]).length;
  }

  // Fase 7: si el recordatorio no llegó a salir (fallido), el prospecto se
  // quedaría en «contactado» para siempre (el índice único impide otro).
  // 7 días después, también «sin_respuesta».
  const { data: fall, error: e3 } = await db
    .from("captacion_envios")
    .select("prospecto_id, captacion_prospectos!inner(etapa)")
    .eq("company_id", companyId)
    .eq("tipo", "recordatorio")
    .eq("estado", "fallido")
    .lte("reclamado_at", limite)
    .eq("captacion_prospectos.etapa", "contactado")
    .limit(500);
  if (e3) throw new Error(`Sin respuesta: ${e3.message}`);
  const idsF = ((fall ?? []) as Array<{ prospecto_id: string }>).map((x) => x.prospecto_id);
  if (idsF.length > 0) {
    const { data: u2, error: e4 } = await db
      .from("captacion_prospectos")
      .update({ etapa: "sin_respuesta" })
      .eq("company_id", companyId)
      .in("id", idsF)
      .eq("etapa", "contactado")
      .select("id");
    if (e4) throw new Error(e4.message);
    n += ((u2 ?? []) as unknown[]).length;
  }
  return n;
}

async function contarEnviados24h(db: Admin, companyId: string, ahora: Date, campanaId?: string): Promise<number> {
  let q = db
    .from("captacion_envios")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .gte("enviado_at", new Date(ahora.getTime() - DIA_MS).toISOString());
  if (campanaId) q = q.eq("campana_id", campanaId);
  const { count, error } = await q;
  if (error) throw new Error(`No se pudieron contar los envíos: ${error.message}`);
  return count ?? 0;
}

// -----------------------------------------------------------------------------
// Pasada del cron
// -----------------------------------------------------------------------------

export async function procesarColaEnvios(opts: { presupuestoMs: number; ahora?: Date }): Promise<ResumenEnvios> {
  const inicio = Date.now();
  const ahora = opts.ahora ?? new Date();
  const r: ResumenEnvios = {
    empresas: 0,
    enviados: 0,
    fallidos: 0,
    cancelados: 0,
    colgados: 0,
    recordatoriosEncolados: 0,
    sinRespuesta: 0,
    pausadasConexion: 0,
    cortacircuitos: 0,
    motivos: [],
    errores: [],
  };
  const db = admin();

  // 1) Envíos colgados: se dan por fallidos (no se reintentan).
  try {
    const { data, error } = await db.rpc("captacion_cerrar_envios_colgados", { p_minutos: 15 });
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as Array<{ company_id: string; prospecto_id: string }>;
    r.colgados = filas.length;
    for (const f of filas) {
      await db
        .from("captacion_prospectos")
        .update({ etapa: "fallido", descartado_motivo: "El envío se quedó a medias: revisa en WhatsApp si le llegó." })
        .eq("company_id", f.company_id)
        .eq("id", f.prospecto_id)
        .eq("etapa", "en_cola");
    }
  } catch (e) {
    r.errores.push(`colgados: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Fase 7: conexión caída o calidad roja/amarilla → se pausa todo lo de
  // esa empresa (con aviso). No se reanuda sola.
  const rc = await revisarConexiones();
  r.pausadasConexion = rc.pausadas;
  r.errores.push(...rc.errores);

  // 3) Empresas candidatas: conexión activa con los envíos encendidos.
  const { data: cons, error: eCon } = await db
    .from("captacion_conexiones")
    .select("company_id, phone_number_id, calidad, limite_diario_meta, margen_seguridad, tope_gasto_mensual_cents")
    .eq("estado", "activa")
    .eq("envios_activos", true);
  if (eCon) {
    r.errores.push(`conexiones: ${eCon.message}`);
    return r;
  }
  const enServicio = await empresasEnServicio(db);

  for (const con of (cons ?? []) as Array<{
    company_id: string;
    phone_number_id: string | null;
    calidad: string;
    limite_diario_meta: number;
    margen_seguridad: number;
    tope_gasto_mensual_cents: number;
  }>) {
    if (Date.now() - inicio > opts.presupuestoMs) {
      r.motivos.push("Sin tiempo: el resto, en la siguiente pasada.");
      break;
    }
    if (!enServicio.has(con.company_id)) continue;
    // Las tres llaves, siempre con la función del guard.
    if (!(await enviosEnFrioPermitidos(con.company_id))) continue;
    if (con.calidad === "roja") {
      r.motivos.push(`${con.company_id}: calidad del número en rojo`);
      continue;
    }
    if (!con.phone_number_id) continue;
    r.empresas++;
    try {
      await procesarEmpresa(con.company_id, con, ahora, inicio + opts.presupuestoMs, r);
    } catch (e) {
      r.errores.push(`${con.company_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return r;
}

async function procesarEmpresa(
  companyId: string,
  con: {
    phone_number_id: string | null;
    limite_diario_meta: number;
    margen_seguridad: number;
    tope_gasto_mensual_cents: number;
  },
  ahora: Date,
  fin: number,
  r: ResumenEnvios,
): Promise<void> {
  const db = admin();
  r.sinRespuesta += await marcarSinRespuesta(companyId, ahora);

  const token = await obtenerToken(companyId);
  if (!token) {
    r.motivos.push(`${companyId}: sin token de Meta`);
    return;
  }

  const [{ data: camps, error: eC }, { data: plants, error: eP }] = await Promise.all([
    db
      .from("captacion_campanas")
      .select(
        "id, nombre, estado, plantilla_primer_contacto_id, plantilla_recordatorio_id, recordatorio_dias, tope_diario, escalado, lanzada_at, reanudada_at, horario",
      )
      .eq("company_id", companyId)
      .eq("estado", "activa"),
    db
      .from("captacion_plantillas")
      .select("id, nombre, idioma, estado, uso, componentes")
      .eq("company_id", companyId)
      .eq("estado", "aprobada"),
  ]);
  if (eC || eP) throw new Error((eC ?? eP).message);
  const campanas = (camps ?? []) as CampanaFila[];
  const plantillas = (plants ?? []) as PlantillaFila[];
  if (campanas.length === 0) return;

  // Fase 7: tope de gasto mensual (suma de filas). Al 100 % no sale nada
  // más este mes; lo que cabe limita el presupuesto de la pasada.
  const gasto = await controlarGasto(companyId, con.tope_gasto_mensual_cents, ahora);
  if (gasto.nivel === "tope") {
    r.motivos.push(`${companyId}: tope de gasto del mes alcanzado`);
    return;
  }

  let presupuesto = Math.min(
    presupuestoEmpresa(con.limite_diario_meta, con.margen_seguridad, await contarEnviados24h(db, companyId, ahora)),
    gasto.enviosQueCaben,
  );

  for (const c of campanas) {
    if (Date.now() > fin) return;
    // Fase 7: cortacircuitos antes de mandar nada más de esta campaña.
    if (await aplicarCortacircuitos(companyId, c)) {
      r.cortacircuitos++;
      r.motivos.push(`${c.nombre}: pausada por el cortacircuitos`);
      continue;
    }
    const minutosRestantes = minutosRestantesHorario(leerHorario(c.horario), ahora);
    if (minutosRestantes === 0) continue;

    const plantillaPrimer = elegirPlantilla(plantillas, c.plantilla_primer_contacto_id, "primer_contacto");
    const plantillaRec = elegirPlantilla(plantillas, c.plantilla_recordatorio_id, "recordatorio");
    if (!plantillaPrimer && !plantillaRec) {
      r.motivos.push(`${c.nombre}: sin plantilla aprobada`);
      continue;
    }
    if (plantillaRec) r.recordatoriosEncolados += await encolarRecordatorios(companyId, c, ahora);

    if (presupuesto <= 0) {
      r.motivos.push(`${companyId}: presupuesto de 24 h agotado`);
      return;
    }
    // Tras una pausa automática el escalado vuelve a empezar (fase 7).
    const dias = diasEscalado(c.lanzada_at, c.reanudada_at, ahora);
    const topeHoy = topeCampanaHoy(leerEscalado(c.escalado), c.tope_diario, dias);
    const enviadosCampana = await contarEnviados24h(db, companyId, ahora, c.id);
    const restante = Math.min(presupuesto, topeHoy - enviadosCampana);
    const n = trozoDePasada(restante, minutosRestantes);
    if (n <= 0) continue;

    const token_reclamo = randomUUID();
    const { data: rec, error: eR } = await db.rpc("captacion_reclamar_envios", {
      p_company_id: companyId,
      p_campana_id: c.id,
      p_limite: n,
      p_token: token_reclamo,
    });
    if (eR) throw new Error(`No se pudo reservar la tanda: ${eR.message}`);
    const reclamados = (rec ?? []) as EnvioFila[];

    let cortar = false;
    for (const e of reclamados) {
      if (cortar || Date.now() > fin || presupuesto <= 0) break;
      const plantilla = e.tipo === "primer_contacto" ? plantillaPrimer : plantillaRec;
      if (!plantilla) {
        if (e.tipo === "recordatorio") {
          await finalizarEnvio(companyId, e.id, { estado: "cancelado", cancelado_motivo: "Sin plantilla de recordatorio aprobada" });
          r.cancelados++;
        }
        continue; // el primer contacto vuelve a la cola al final
      }
      const res = await enviarUno(companyId, con.phone_number_id!, token, e, plantilla);
      if (res === "enviado") {
        r.enviados++;
        presupuesto--;
      } else if (res === "cancelado") r.cancelados++;
      else {
        r.fallidos++;
        if (res === "corte") {
          cortar = true;
          r.motivos.push(`${companyId}: Meta ha cortado la tanda`);
        }
      }
    }

    // Lo reservado que no ha salido vuelve a la cola, tal cual.
    await db
      .from("captacion_envios")
      .update({ estado: "en_cola", token_reclamo: null, reclamado_at: null })
      .eq("company_id", companyId)
      .eq("token_reclamo", token_reclamo)
      .eq("estado", "reclamado");
    if (cortar) return;
  }
}

async function finalizarEnvio(companyId: string, envioId: string, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await admin()
    .from("captacion_envios")
    .update({ token_reclamo: null, ...cambios })
    .eq("company_id", companyId)
    .eq("id", envioId);
  if (error) throw new Error(`No se pudo apuntar el envío: ${error.message}`);
}

async function cambiarEtapa(companyId: string, prospectoId: string, desde: string[], cambios: Record<string, unknown>) {
  await admin()
    .from("captacion_prospectos")
    .update(cambios)
    .eq("company_id", companyId)
    .eq("id", prospectoId)
    .in("etapa", desde);
}

/** «Segunda mirada» y envío de UN mensaje reservado. */
async function enviarUno(
  companyId: string,
  phoneNumberId: string,
  token: string,
  e: EnvioFila,
  plantilla: PlantillaFila,
): Promise<"enviado" | "cancelado" | "fallido" | "corte"> {
  const db = admin();
  const esPrimero = e.tipo === "primer_contacto";
  const etapasValidas = esPrimero ? ["en_cola"] : ["contactado"];
  const cancelar = async (motivo: string, etapa?: { etapa: string; [k: string]: unknown }) => {
    await finalizarEnvio(companyId, e.id, { estado: "cancelado", cancelado_motivo: motivo });
    if (etapa) await cambiarEtapa(companyId, e.prospecto_id, etapasValidas, etapa);
    return "cancelado" as const;
  };

  const { data: pr, error: eP } = await db
    .from("captacion_prospectos")
    .select("id, nombre_negocio, telefono_e164, bsuid, etapa, codigo_postal, cliente_coincidente_id, lead_coincidente_id")
    .eq("company_id", companyId)
    .eq("id", e.prospecto_id)
    .maybeSingle();
  if (eP) throw new Error(eP.message);
  const p = pr as ProspectoEnvio | null;
  if (!p) return cancelar("El negocio ya no existe");
  if (!etapasValidas.includes(p.etapa)) return cancelar(`El negocio ya está en «${p.etapa}»`);
  if (!p.telefono_e164 && !p.bsuid) return cancelar("Sin teléfono ni identificador de WhatsApp");

  // Segunda mirada (§4.3.9): entre encolar y enviar pueden pasar horas.
  if (await contactoBloqueado(companyId, p.telefono_e164, p.bsuid)) {
    return cancelar("Bloqueado", { etapa: "descartado", descartado_motivo: "Está en la lista de bloqueo" });
  }
  if (esPrimero) {
    if (p.cliente_coincidente_id || p.lead_coincidente_id) {
      return cancelar("Ya es cliente o lead", { etapa: "revisar", revisar_motivo: "Coincide con un cliente o lead" });
    }
    const { data: coinc, error: eCo } = await db.rpc("captacion_coincidencias", {
      p_company_id: companyId,
      p_tel9: p.telefono_e164 ? p.telefono_e164.slice(-9) : null,
      p_nombre: p.nombre_negocio,
      p_cp: p.codigo_postal,
    });
    if (eCo) throw new Error(`Deduplicación: ${eCo.message}`);
    const lista = (coinc ?? []) as Array<{ customer_id: string | null; lead_id: string | null; motivo: string }>;
    if (lista.length > 0) {
      return cancelar("Se ha dado de alta como cliente o lead", {
        etapa: "revisar",
        revisar_motivo: lista.some((x) => x.motivo === "telefono")
          ? "Su teléfono ya es de un cliente o lead"
          : "Nombre parecido a un cliente o lead del mismo código postal",
        cliente_coincidente_id: lista.find((x) => x.customer_id)?.customer_id ?? null,
        lead_coincidente_id: lista.find((x) => x.lead_id)?.lead_id ?? null,
      });
    }
  }
  {
    // ¿Ha escrito ya él (texto o botón)? Entonces no se le manda el mensaje en
    // frío, ni el recordatorio: este es solo para quien no ha contestado nada
    // (fase 7; la etapa «contactado» ya lo dice, esto es la segunda mirada).
    const filtros = [`prospecto_id.eq.${p.id}`];
    if (p.bsuid && /^[A-Za-z0-9._-]{1,128}$/.test(p.bsuid)) filtros.push(`bsuid.eq.${p.bsuid}`);
    const wa = digitos(p.telefono_e164);
    if (wa && /^\d{6,20}$/.test(wa)) filtros.push(`wa_id.eq.${wa}`);
    const { data: convs } = await db
      .from("captacion_conversaciones")
      .select("id")
      .eq("company_id", companyId)
      .or(filtros.join(","));
    const idsConv = ((convs ?? []) as Array<{ id: string }>).map((x) => x.id);
    if (idsConv.length > 0) {
      const { data: entr } = await db
        .from("captacion_mensajes")
        .select("id")
        .eq("company_id", companyId)
        .in("conversacion_id", idsConv)
        .eq("direccion", "entrante")
        .limit(1);
      if ((entr ?? []).length > 0) {
        return cancelar(
          esPrimero ? "Ya nos ha escrito: se le contesta desde la bandeja" : "Ya ha contestado: no se le recuerda",
          { etapa: "conversando" },
        );
      }
    }
  }

  const a = analizarPlantilla(plantilla.componentes);
  if (!a.botones) return cancelar("La plantilla no tiene los botones Sí/No");
  const nombre = parametroNombre(p.nombre_negocio);
  const destino = { waId: digitos(p.telefono_e164), bsuid: p.bsuid };

  let wamid: string;
  try {
    wamid = await enviarPlantilla(token, phoneNumberId, destino, {
      nombre: plantilla.nombre,
      idioma: plantilla.idioma,
      parametroCuerpo: a.variablesCuerpo === 1 ? nombre : null,
      cargas: [
        { indice: a.botones.si, carga: cargaBoton("si", e.id) },
        { indice: a.botones.no, carga: cargaBoton("no", e.id) },
      ],
    });
  } catch (err) {
    if (err instanceof ErrorMeta) {
      await finalizarEnvio(companyId, e.id, {
        estado: "fallido",
        plantilla_id: plantilla.id,
        error_codigo: err.codigo,
        error_texto: err.message.slice(0, 500),
      });
      if (err.codigo === ERROR_SIN_WHATSAPP) {
        await cambiarEtapa(companyId, p.id, etapasValidas, { etapa: "fallido", descartado_motivo: "Ese número no tiene WhatsApp" });
      }
      return errorCortaTanda(err.codigo) ? "corte" : "fallido";
    }
    // Sin respuesta de Meta: no se sabe si salió. No se reintenta (§5.3).
    await finalizarEnvio(companyId, e.id, {
      estado: "fallido",
      plantilla_id: plantilla.id,
      error_texto: `Resultado desconocido: ${err instanceof Error ? err.message.slice(0, 300) : "sin respuesta"}`,
    });
    if (esPrimero) {
      await cambiarEtapa(companyId, p.id, etapasValidas, {
        etapa: "fallido",
        descartado_motivo: "No se sabe si le llegó el mensaje: revísalo a mano.",
      });
    }
    return "corte";
  }

  await finalizarEnvio(companyId, e.id, {
    estado: "enviado",
    wamid,
    plantilla_id: plantilla.id,
    enviado_at: new Date().toISOString(),
  });
  await cambiarEtapa(companyId, p.id, etapasValidas, { etapa: esPrimero ? "contactado" : "recordado" });

  // A la bandeja. Ya ha salido: si esto falla, se anota y no se repite nada.
  try {
    const conversacionId = await conversacionPara(companyId, { waId: destino.waId, bsuid: destino.bsuid, nombre: null });
    await db
      .from("captacion_conversaciones")
      .update({ prospecto_id: p.id })
      .eq("company_id", companyId)
      .eq("id", conversacionId)
      .is("prospecto_id", null);
    const { error: eM } = await db.from("captacion_mensajes").insert({
      company_id: companyId,
      conversacion_id: conversacionId,
      direccion: "saliente",
      autor: "sistema",
      origen: "api",
      tipo: "plantilla",
      cuerpo: renderizarCuerpo(a.cuerpo, nombre),
      wamid,
      estado: "enviado",
      meta_at: new Date().toISOString(),
    });
    if (eM) throw new Error(eM.message);
  } catch (err) {
    console.error("[captacion/envios] enviado pero no guardado en la bandeja", e.id, err);
  }
  return "enviado";
}

// -----------------------------------------------------------------------------
// Estados del webhook
// -----------------------------------------------------------------------------

/**
 * Estados de Meta → captacion_envios, solo hacia delante. Fase 7: al pasar a
 * entregado (o leído sin haber visto el entregado) se apunta el coste. Si se
 * pasa `valorWebhook` (el `value` crudo del cambio `messages`), se usa el
 * `pricing` de Meta (billable, category); si no, la tarifa de marketing.
 */
export async function aplicarEstadosEnvios(
  companyId: string,
  estados: EstadoNormalizado[],
  valorWebhook?: unknown,
): Promise<void> {
  const db = admin();
  const ahora = new Date().toISOString();
  const precios = valorWebhook === undefined ? new Map() : extraerPreciosEstados(valorWebhook);
  for (const s of estados) {
    if (s.estado !== "entregado" && s.estado !== "leido" && s.estado !== "fallido") continue;
    const cambios: Record<string, unknown> =
      s.estado === "entregado"
        ? { estado: "entregado", entregado_at: ahora }
        : s.estado === "leido"
          ? { estado: "leido", leido_at: ahora }
          : { estado: "fallido", error_codigo: s.errorCodigo, error_texto: s.errorTexto?.slice(0, 500) ?? null };
    const { data, error } = await db
      .from("captacion_envios")
      .update(cambios)
      .eq("company_id", companyId)
      .eq("wamid", s.wamid)
      .in("estado", estadosEnvioAnteriores(s.estado))
      .select("prospecto_id");
    if (error) throw new Error(`No se pudo actualizar el envío: ${error.message}`);
    const fila = ((data ?? []) as Array<{ prospecto_id: string }>)[0];
    if (fila && (s.estado === "entregado" || s.estado === "leido")) {
      // Una sola vez: solo si aún no tiene coste.
      const c = costeEnvio(precios.get(s.wamid) ?? null);
      const { error: eC } = await db
        .from("captacion_envios")
        .update({
          coste_milicentimos: c.milicentimos,
          coste_cents: milicentimosACents(c.milicentimos),
          coste_categoria: c.categoria,
        })
        .eq("company_id", companyId)
        .eq("wamid", s.wamid)
        .is("coste_milicentimos", null)
        .in("estado", ["entregado", "leido"]);
      if (eC) console.error("[captacion/envios] coste no apuntado", s.wamid, eC.message);
    }
    if (fila && s.estado === "fallido" && s.errorCodigo === ERROR_SIN_WHATSAPP) {
      await cambiarEtapa(companyId, fila.prospecto_id, ["en_cola", "contactado", "recordado"], {
        etapa: "fallido",
        descartado_motivo: "Ese número no tiene WhatsApp",
      });
    }
  }
}
