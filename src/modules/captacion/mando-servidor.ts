import "server-only";
import { empresasEnServicio } from "@/shared/lib/empresas/en-servicio";
import { captacionActiva } from "./guard";
import { admin } from "./servidor";
import { avisarGestion } from "./avisos";
import { propuestaPorId } from "./propuesta-servidor";
import { mandarPropuesta, plantillaDocumentoAprobada } from "./propuesta-envio";
import {
  claveMes,
  CORTACIRCUITOS,
  decidirReintento,
  EMBUDO_VACIO,
  evaluarCortacircuitos,
  evaluarGasto,
  inicioMesMadrid,
  leerEmbudo,
  MAX_REINTENTOS_PROPUESTA,
  motivoPausaConexion,
  tasasEmbudo,
  type Embudo,
  type EstadoGasto,
  type TasasEmbudo,
} from "./mando-logica";

/**
 * Fase 7 (mando completo): cortacircuitos, pausa por la conexión, tope de
 * gasto mensual, reintento del PDF y datos del embudo. Todo con el cliente de
 * servicio y company_id explícito en cada filtro.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

// -----------------------------------------------------------------------------
// Pausas automáticas
// -----------------------------------------------------------------------------

/**
 * Pausa las campañas activas de la empresa (todas o las dadas) con su motivo
 * y avisa a admin y directores. La actualización condicionada a «activa» es
 * el cerrojo: dos pasadas a la vez no avisan dos veces. No se reanuda sola.
 */
export async function pausarCampanas(companyId: string, motivo: string, ids?: string[]): Promise<number> {
  const db = admin();
  let q = db
    .from("captacion_campanas")
    .update({ estado: "pausada", motivo_pausa: motivo, pausa_automatica: true, pausada_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("estado", "activa");
  if (ids) {
    if (ids.length === 0) return 0;
    q = q.in("id", ids);
  }
  const { data, error } = await q.select("id, nombre");
  if (error) throw new Error(`No se pudo pausar: ${error.message}`);
  const filas = (data ?? []) as Array<{ id: string; nombre: string }>;
  if (filas.length > 0) {
    const una = filas.length === 1 ? filas[0]! : null;
    await avisarGestion(companyId, {
      kind: "captacion.campana_pausada",
      severity: "error",
      title: una ? `Campaña «${una.nombre}» en pausa` : `${filas.length} campañas de captación en pausa`,
      body: `${motivo} No se reanuda sola: revísalo y reanúdala desde la campaña.`,
      actionUrl: una ? `/captacion/campanas/${una.id}` : "/captacion",
      sujetoId: una?.id ?? null,
    });
  }
  return filas.length;
}

/**
 * Si la conexión deja de estar activa o la calidad del número baja (roja o
 * amarilla), se pausa TODO lo de esa empresa. Se mira en cada pasada del cron,
 * también para las empresas que el cron de envíos ya no procesa.
 */
export async function revisarConexiones(): Promise<{ pausadas: number; errores: string[] }> {
  const db = admin();
  const out = { pausadas: 0, errores: [] as string[] };
  const { data: camps, error } = await db.from("captacion_campanas").select("company_id").eq("estado", "activa").limit(1000);
  if (error) {
    out.errores.push(`campañas activas: ${error.message}`);
    return out;
  }
  const empresas = [...new Set(((camps ?? []) as Array<{ company_id: string }>).map((c) => c.company_id))];
  if (empresas.length === 0) return out;
  const { data: cons, error: eCon } = await db
    .from("captacion_conexiones")
    .select("company_id, estado, calidad")
    .in("company_id", empresas);
  if (eCon) {
    out.errores.push(`conexiones: ${eCon.message}`);
    return out;
  }
  const porEmpresa = new Map(
    ((cons ?? []) as Array<{ company_id: string; estado: string; calidad: string }>).map((c) => [c.company_id, c]),
  );
  for (const companyId of empresas) {
    const motivo = motivoPausaConexion(porEmpresa.get(companyId) ?? null);
    if (!motivo) continue;
    // Sin el módulo activo no sale nada de todas formas: no se molesta a nadie.
    if (!(await captacionActiva(companyId))) continue;
    try {
      out.pausadas += await pausarCampanas(companyId, motivo);
    } catch (e) {
      out.errores.push(`${companyId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/** Cortacircuitos de UNA campaña. true = ha saltado (y la campaña queda pausada). */
export async function aplicarCortacircuitos(
  companyId: string,
  c: { id: string; reanudada_at: string | null },
): Promise<boolean> {
  const { data, error } = await admin().rpc("captacion_muestra_cortacircuitos", {
    p_company_id: companyId,
    p_campana_id: c.id,
    p_desde: c.reanudada_at,
    p_tamano: CORTACIRCUITOS.muestra,
  });
  if (error) throw new Error(`Cortacircuitos: ${error.message}`);
  const fila = (Array.isArray(data) ? data[0] : data) as
    | { intentos: number; fallidos: number; prospectos: number; noes: number }
    | undefined;
  if (!fila) return false;
  const r = evaluarCortacircuitos(fila);
  if (!r.salta) return false;
  await pausarCampanas(companyId, r.motivo, [c.id]);
  return true;
}

// -----------------------------------------------------------------------------
// Gasto del mes
// -----------------------------------------------------------------------------

async function leerGasto(db: Admin, rpc: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(rpc, args);
  if (error) throw new Error(`Gasto: ${error.message}`);
  const f = (Array.isArray(data) ? data[0] : data) as
    | { confirmado_milicentimos: number | string; en_vuelo: number; cobrados: number }
    | undefined;
  return {
    confirmadoMilicentimos: Number(f?.confirmado_milicentimos ?? 0),
    enVuelo: Number(f?.en_vuelo ?? 0),
    cobrados: Number(f?.cobrados ?? 0),
  };
}

/** Gasto del mes (hora de Madrid) frente al tope: suma de filas. */
export async function gastoMes(companyId: string, topeCents: number, ahora = new Date()): Promise<EstadoGasto & { cobrados: number }> {
  const g = await leerGasto(admin(), "captacion_gasto_mes", {
    p_company_id: companyId,
    p_desde: inicioMesMadrid(ahora).toISOString(),
  });
  return { ...evaluarGasto({ ...g, topeCents }), cobrados: g.cobrados };
}

/**
 * Gasto del mes y avisos: al 80 %, al admin; al 100 %, a admin y directores.
 * Una vez al mes: la columna aviso_gasto_*_mes es el cerrojo.
 */
export async function controlarGasto(companyId: string, topeCents: number, ahora = new Date()): Promise<EstadoGasto> {
  const g = await gastoMes(companyId, topeCents, ahora);
  if (g.nivel === "ok") return g;
  const mes = claveMes(ahora);
  const columna = g.nivel === "tope" ? "aviso_gasto_tope_mes" : "aviso_gasto_80_mes";
  const cambios: Record<string, string> = { [columna]: mes };
  if (g.nivel === "tope") cambios.aviso_gasto_80_mes = mes;
  const { data, error } = await admin()
    .from("captacion_conexiones")
    .update(cambios)
    .eq("company_id", companyId)
    .or(`${columna}.is.null,${columna}.neq.${mes}`)
    .select("company_id");
  if (error) {
    console.error("[captacion/gasto] aviso:", error.message);
    return g;
  }
  if (((data ?? []) as unknown[]).length > 0) {
    const pct = g.porcentaje == null ? "" : ` (${Math.floor(g.porcentaje)} %)`;
    await avisarGestion(
      companyId,
      g.nivel === "tope"
        ? {
            kind: "captacion.gasto_tope",
            severity: "error",
            title: "Captación: tope de gasto del mes alcanzado",
            body: `Se ha llegado al tope de gasto en WhatsApp${pct}. No sale ningún mensaje en frío más este mes. Las conversaciones abiertas siguen.`,
            actionUrl: "/captacion",
            sujetoId: null,
          }
        : {
            kind: "captacion.gasto_aviso",
            severity: "warning",
            title: "Captación: 80 % del gasto del mes",
            body: `El gasto en WhatsApp de este mes va por el 80 % del tope${pct}. Al llegar al 100 % se paran los mensajes en frío.`,
            actionUrl: "/captacion",
            sujetoId: null,
          },
      g.nivel === "tope" ? undefined : ["company_admin"],
    );
  }
  return g;
}

// -----------------------------------------------------------------------------
// Datos del mando
// -----------------------------------------------------------------------------

export interface CampanaPausada {
  id: string;
  nombre: string;
  motivo: string | null;
  automatica: boolean;
}

export interface DatosMando {
  embudo: Embudo;
  tasas: TasasEmbudo;
  /** Gasto de la empresa este mes frente al tope. Null si no hay conexión. */
  gasto: (EstadoGasto & { cobrados: number }) | null;
  /** Solo en la campaña: lo que lleva gastado (todo) y lo de este mes. */
  gastoCampana: { totalMilicentimos: number; mesMilicentimos: number; enVuelo: number } | null;
  pausadas: CampanaPausada[];
}

export async function datosMando(companyId: string, campanaId: string | null, ahora = new Date()): Promise<DatosMando> {
  const db = admin();
  let qPausadas = db
    .from("captacion_campanas")
    .select("id, nombre, motivo_pausa, pausa_automatica")
    .eq("company_id", companyId)
    .eq("estado", "pausada")
    .order("pausada_at", { ascending: false, nullsFirst: false })
    .limit(20);
  if (campanaId) qPausadas = qPausadas.eq("id", campanaId);

  const [emb, con, pausadas] = await Promise.all([
    db.rpc("captacion_embudo", { p_company_id: companyId, p_campana_id: campanaId }),
    db.from("captacion_conexiones").select("tope_gasto_mensual_cents").eq("company_id", companyId).maybeSingle(),
    qPausadas,
  ]);
  if (emb.error) console.error("[captacion/mando] embudo:", emb.error.message);
  const embudo = emb.error ? EMBUDO_VACIO : leerEmbudo(Array.isArray(emb.data) ? emb.data[0] : emb.data);
  const tope = (con.data as { tope_gasto_mensual_cents: number } | null)?.tope_gasto_mensual_cents;
  const gasto = tope == null ? null : await gastoMes(companyId, tope, ahora);

  let gastoCampana: DatosMando["gastoCampana"] = null;
  if (campanaId) {
    const [total, mes] = await Promise.all([
      leerGasto(db, "captacion_gasto_campana", { p_company_id: companyId, p_campana_id: campanaId, p_desde: null }),
      leerGasto(db, "captacion_gasto_campana", {
        p_company_id: companyId,
        p_campana_id: campanaId,
        p_desde: inicioMesMadrid(ahora).toISOString(),
      }),
    ]);
    gastoCampana = { totalMilicentimos: total.confirmadoMilicentimos, mesMilicentimos: mes.confirmadoMilicentimos, enVuelo: total.enVuelo };
  }

  return {
    embudo,
    tasas: tasasEmbudo(embudo),
    gasto,
    gastoCampana,
    pausadas: ((pausadas.data ?? []) as Array<{ id: string; nombre: string; motivo_pausa: string | null; pausa_automatica: boolean }>).map(
      (p) => ({ id: p.id, nombre: p.nombre, motivo: p.motivo_pausa, automatica: p.pausa_automatica }),
    ),
  };
}

// -----------------------------------------------------------------------------
// Reintento del PDF de la propuesta
// -----------------------------------------------------------------------------

export interface ResumenReintentos {
  revisadas: number;
  enviadas: number;
  fallidas: number;
  agotadas: number;
  errores: string[];
}

interface PropuestaFallida {
  id: string;
  company_id: string;
  conversacion_id: string | null;
  envio_error: string | null;
  enviada_at: string | null;
  revocada_at: string | null;
  caduca_at: string;
  envio_intentos: number;
  ultimo_intento_at: string | null;
  created_at: string;
}

async function agotar(companyId: string, id: string): Promise<void> {
  await admin()
    .from("captacion_propuestas")
    .update({ envio_intentos: MAX_REINTENTOS_PROPUESTA })
    .eq("company_id", companyId)
    .eq("id", id);
}

async function bloqueado(companyId: string, waId: string | null, bsuid: string | null): Promise<boolean> {
  const db = admin();
  const filtros: string[] = [];
  if (waId && /^\d{6,20}$/.test(waId)) filtros.push(`and(ambito.eq.telefono,valor.eq.+${waId})`);
  if (bsuid && /^[A-Za-z0-9._-]{1,128}$/.test(bsuid)) filtros.push(`and(ambito.eq.bsuid,valor.eq.${bsuid})`);
  if (filtros.length === 0) return false;
  const { data, error } = await db.from("captacion_bloqueos").select("id").eq("company_id", companyId).or(filtros.join(",")).limit(1);
  // Si no se puede comprobar, se da por bloqueado: mejor no mandar.
  return Boolean(error) || ((data ?? []) as unknown[]).length > 0;
}

/**
 * Vuelve a intentar mandar el PDF de las propuestas que fallaron (fase 4 deja
 * el error en envio_error). Como mucho 3 veces y 10 minutos entre intentos.
 * Dentro de la ventana de 24 h, como mensaje de servicio; fuera, solo si la
 * empresa tiene plantilla aprobada de uso «documento» (fase 8). El intento se
 * reserva con una actualización condicionada sobre envio_intentos: dos
 * pasadas a la vez no mandan dos veces.
 */
export async function reintentarPropuestas(opts: { presupuestoMs: number; ahora?: Date }): Promise<ResumenReintentos> {
  const inicio = Date.now();
  const ahora = opts.ahora ?? new Date();
  const r: ResumenReintentos = { revisadas: 0, enviadas: 0, fallidas: 0, agotadas: 0, errores: [] };
  const db = admin();
  const { data, error } = await db
    .from("captacion_propuestas")
    .select("id, company_id, conversacion_id, envio_error, enviada_at, revocada_at, caduca_at, envio_intentos, ultimo_intento_at, created_at")
    .not("envio_error", "is", null)
    .is("enviada_at", null)
    .is("revocada_at", null)
    .lt("envio_intentos", MAX_REINTENTOS_PROPUESTA)
    .gt("caduca_at", ahora.toISOString())
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    r.errores.push(`propuestas: ${error.message}`);
    return r;
  }
  const filas = (data ?? []) as PropuestaFallida[];
  if (filas.length === 0) return r;
  const enServicio = await empresasEnServicio(db);
  const activas = new Map<string, boolean>();
  // Fase 8: ¿tiene la empresa plantilla de documento? (para la ventana cerrada)
  const conPlantilla = new Map<string, boolean>();

  for (const p of filas) {
    if (Date.now() - inicio > opts.presupuestoMs) break;
    if (!enServicio.has(p.company_id)) continue;
    if (!activas.has(p.company_id)) activas.set(p.company_id, await captacionActiva(p.company_id));
    if (!activas.get(p.company_id)) continue;
    r.revisadas++;
    try {
      if (!p.conversacion_id) {
        await agotar(p.company_id, p.id);
        r.agotadas++;
        continue;
      }
      const { data: conv } = await db
        .from("captacion_conversaciones")
        .select("id, wa_id, bsuid, ventana_hasta, modo")
        .eq("company_id", p.company_id)
        .eq("id", p.conversacion_id)
        .maybeSingle();
      const c = conv as { id: string; wa_id: string | null; bsuid: string | null; ventana_hasta: string | null; modo: string } | null;
      if (!conPlantilla.has(p.company_id)) {
        conPlantilla.set(p.company_id, Boolean(await plantillaDocumentoAprobada(p.company_id)));
      }
      const d = decidirReintento(
        {
          envioError: p.envio_error,
          enviadaAt: p.enviada_at,
          revocadaAt: p.revocada_at,
          caducaAt: p.caduca_at,
          intentos: p.envio_intentos,
          ultimoIntentoAt: p.ultimo_intento_at,
          ventanaHasta: c?.ventana_hasta ?? null,
          modoConversacion: c?.modo ?? "cerrada",
          plantillaDocumento: conPlantilla.get(p.company_id) ?? false,
        },
        ahora,
      );
      if (!d.reintentar) {
        if (d.agotar) {
          await agotar(p.company_id, p.id);
          r.agotadas++;
        }
        continue;
      }
      if (!c || (await bloqueado(p.company_id, c.wa_id, c.bsuid))) {
        await agotar(p.company_id, p.id);
        r.agotadas++;
        continue;
      }

      // ¿Salió ya un documento por esta conversación desde que se creó la
      // propuesta (por ejemplo, el primer intento llegó a Meta pero no se
      // anotó)? Entonces no se repite.
      const { data: doc } = await db
        .from("captacion_mensajes")
        .select("id")
        .eq("company_id", p.company_id)
        .eq("conversacion_id", c.id)
        .eq("direccion", "saliente")
        .eq("tipo", "documento")
        .gte("created_at", p.created_at)
        .limit(1);
      if (((doc ?? []) as unknown[]).length > 0) {
        await db
          .from("captacion_propuestas")
          .update({ enviada_at: ahora.toISOString(), envio_error: null })
          .eq("company_id", p.company_id)
          .eq("id", p.id);
        continue;
      }

      // Reserva del intento.
      const { data: reservada } = await db
        .from("captacion_propuestas")
        .update({ envio_intentos: p.envio_intentos + 1, ultimo_intento_at: ahora.toISOString() })
        .eq("company_id", p.company_id)
        .eq("id", p.id)
        .eq("envio_intentos", p.envio_intentos)
        .is("enviada_at", null)
        .select("id");
      if (((reservada ?? []) as unknown[]).length === 0) continue;

      try {
        await mandarPdf(p.company_id, p.id, c);
        r.enviadas++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        r.fallidas++;
        await db
          .from("captacion_propuestas")
          .update({ envio_error: `Reintento ${p.envio_intentos + 1}: ${msg}`.slice(0, 500) })
          .eq("company_id", p.company_id)
          .eq("id", p.id);
      }
    } catch (e) {
      r.errores.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return r;
}

/**
 * Lo mismo que hace la fase 4 al decir «Sí», con la propuesta ya creada. Desde
 * la fase 8 la vía (documento normal o plantilla de documento) la decide
 * mandarPropuesta() con la ventana que haya en la base.
 */
async function mandarPdf(
  companyId: string,
  propuestaId: string,
  c: { id: string; wa_id: string | null; bsuid: string | null; ventana_hasta: string | null },
): Promise<void> {
  const prop = await propuestaPorId(companyId, propuestaId);
  if (!prop) throw new Error("La propuesta ya no existe.");
  if (prop.enviada_at) return;
  await mandarPropuesta({
    companyId,
    prop,
    destino: { conversacionId: c.id, waId: c.wa_id, bsuid: c.bsuid, ventanaHasta: c.ventana_hasta },
  });
}
