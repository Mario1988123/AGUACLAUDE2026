"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { captacionActiva } from "./guard";
import { admin } from "./servidor";
import { procesarColaBusquedas } from "./busqueda";
import { placesConfigurado, topePlacesMensual } from "./places";
import { contactablePorWhatsapp, filtroOsmValido, zonaValida, type Zona } from "./busqueda-logica";
import { elegirPlantilla, encolarProspectos, type PlantillaFila } from "./envios-servidor";
import { leerEscalado, leerHorario, topeCampanaHoy, type Horario } from "./envios-logica";
import { diasEscalado, motivoPausaConexion } from "./mando-logica";

/**
 * Campañas (versión mínima de la fase 6: a quién y dónde) y revisión de
 * prospectos. Todo con el cliente de servicio, filtrando siempre por la
 * empresa de la sesión, y solo para quien gestiona el módulo.
 */

const GESTORES = ["company_admin", "commercial_director", "telemarketing_director"];

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function esGestor(s: SessionClaims): boolean {
  return s.is_superadmin || s.roles.some((r) => GESTORES.includes(r));
}

async function sesionGestor() {
  const s = await requireSession();
  if (!s.company_id) throw new Error("Sin empresa.");
  if (!esGestor(s)) throw new Error("No tienes permiso para gestionar las campañas de captación.");
  if (!(await captacionActiva(s.company_id))) throw new Error("El módulo de captación no está activo.");
  return s as SessionClaims & { company_id: string };
}

// -----------------------------------------------------------------------------
// Lectura
// -----------------------------------------------------------------------------

/** Conteo exacto por etapa (sin traer filas: PostgREST corta en 1.000). */
async function contarPorEtapa(companyId: string, campanaId: string, etapas: string[]): Promise<Record<string, number>> {
  const db = admin();
  const out: Record<string, number> = {};
  await Promise.all(
    etapas.map(async (etapa) => {
      const { count, error } = await db
        .from("captacion_prospectos")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("campana_id", campanaId)
        .eq("etapa", etapa);
      if (error) throw new Error(error.message);
      out[etapa] = count ?? 0;
    }),
  );
  return out;
}

export interface CampanaFila {
  id: string;
  nombre: string;
  estado: string;
  tipologia_clave: string | null;
  zonas: Zona[];
  created_at: string;
}

export interface EnviosCampana {
  estado: string;
  motivoPausa: string | null;
  topeDiario: number;
  topeHoy: number;
  horario: Horario;
  lanzadaAt: string | null;
  enviados24h: number;
  enCola: number;
  /** Plantilla aprobada de primer mensaje (de la campaña o de la empresa). */
  plantillaPrimer: string | null;
  plantillaRecordatorio: string | null;
  /** Conexión activa con los envíos encendidos (sin contar la llave de la plataforma). */
  enviosEncendidos: boolean;
  enviosPlataforma: boolean;
}

export interface TipologiaFila {
  clave: string;
  nombre: string;
}

export async function listarCampanas(): Promise<{ campanas: CampanaFila[]; tipologias: TipologiaFila[]; recuento: Record<string, Record<string, number>> } | null> {
  const s = await requireSession();
  if (!s.company_id || !esGestor(s) || !(await captacionActiva(s.company_id))) return null;
  const db = admin();
  const [{ data: campanas }, { data: tipologias }] = await Promise.all([
    db.from("captacion_campanas").select("id, nombre, estado, tipologia_clave, zonas, created_at")
      .eq("company_id", s.company_id).order("created_at", { ascending: false }).limit(200),
    db.from("captacion_tipologias").select("clave, nombre").order("orden"),
  ]);
  const recuento: Record<string, Record<string, number>> = {};
  await Promise.all(
    ((campanas ?? []) as CampanaFila[]).map(async (c) => {
      recuento[c.id] = await contarPorEtapa(s.company_id!, c.id, ["nuevo", "revisar"]);
    }),
  );
  return {
    campanas: (campanas ?? []) as CampanaFila[],
    tipologias: (tipologias ?? []) as TipologiaFila[],
    recuento,
  };
}

/** Etapas que enseña el mando de la campaña. */
const ETAPAS_MANDO = [
  "nuevo",
  "revisar",
  "en_cola",
  "contactado",
  "recordado",
  "interesado",
  "conversando",
  "caliente",
  "descartado",
  "sin_respuesta",
  "fallido",
] as const;

interface CampanaCompleta extends CampanaFila {
  motivo_pausa: string | null;
  tope_diario: number;
  escalado: unknown;
  lanzada_at: string | null;
  reanudada_at: string | null;
  pausa_automatica: boolean;
  horario: unknown;
  plantilla_primer_contacto_id: string | null;
  plantilla_recordatorio_id: string | null;
}

async function resumenEnvios(companyId: string, c: CampanaCompleta): Promise<EnviosCampana> {
  const db = admin();
  const hace24h = new Date(Date.now() - 86_400_000).toISOString();
  const [enviados, enCola, { data: plants }, { data: con }] = await Promise.all([
    db.from("captacion_envios").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).eq("campana_id", c.id).gte("enviado_at", hace24h),
    db.from("captacion_envios").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).eq("campana_id", c.id).eq("estado", "en_cola"),
    db.from("captacion_plantillas").select("id, nombre, idioma, estado, uso, componentes")
      .eq("company_id", companyId).eq("estado", "aprobada"),
    db.from("captacion_conexiones").select("estado, envios_activos").eq("company_id", companyId).maybeSingle(),
  ]);
  const plantillas = (plants ?? []) as PlantillaFila[];
  // Tras una pausa automática el escalado vuelve a empezar (fase 7).
  const dias = diasEscalado(c.lanzada_at, c.reanudada_at ?? null, new Date());
  const conexion = con as { estado: string; envios_activos: boolean } | null;
  return {
    estado: c.estado,
    motivoPausa: c.motivo_pausa,
    topeDiario: c.tope_diario,
    topeHoy: topeCampanaHoy(leerEscalado(c.escalado), c.tope_diario, dias),
    horario: leerHorario(c.horario),
    lanzadaAt: c.lanzada_at,
    enviados24h: (enviados as { count: number | null }).count ?? 0,
    enCola: (enCola as { count: number | null }).count ?? 0,
    plantillaPrimer: elegirPlantilla(plantillas, c.plantilla_primer_contacto_id, "primer_contacto")?.nombre ?? null,
    plantillaRecordatorio: elegirPlantilla(plantillas, c.plantilla_recordatorio_id, "recordatorio")?.nombre ?? null,
    enviosEncendidos: conexion?.estado === "activa" && conexion.envios_activos === true,
    enviosPlataforma: process.env.CAPTACION_ENVIOS_ACTIVOS === "1",
  };
}

export interface BusquedaFila {
  id: string;
  fuente: "osm" | "places";
  zona: Zona;
  estado: string;
  encontrados: number;
  nuevos: number;
  revisar: number;
  descartados: number;
  error: string | null;
  created_at: string;
  terminada_at: string | null;
  progreso: { i: number; total: number } | null;
}

export interface ProspectoFila {
  id: string;
  nombre_negocio: string;
  municipio: string | null;
  direccion: string | null;
  telefono_e164: string | null;
  es_movil: boolean;
  telefono_fuente: string | null;
  telefono_url_fuente: string | null;
  prioridad: number;
  web: string | null;
  etapa: string;
  revisar_motivo: string | null;
  cliente_coincidente_id: string | null;
  lead_coincidente_id: string | null;
}

export async function obtenerCampana(id: string, etapa: string): Promise<{
  campana: CampanaFila;
  envios: EnviosCampana;
  busquedas: BusquedaFila[];
  prospectos: ProspectoFila[];
  recuento: Record<string, number>;
  places: { configurado: boolean; usadas: number; tope: number };
} | null> {
  const s = await requireSession();
  if (!s.company_id || !esGestor(s) || !(await captacionActiva(s.company_id))) return null;
  if (!z.string().uuid().safeParse(id).success) return null;
  const db = admin();
  const { data: campana } = await db
    .from("captacion_campanas")
    .select(
      "id, nombre, estado, tipologia_clave, zonas, created_at, motivo_pausa, tope_diario, escalado, lanzada_at, reanudada_at, pausa_automatica, horario, plantilla_primer_contacto_id, plantilla_recordatorio_id",
    )
    .eq("id", id)
    .eq("company_id", s.company_id)
    .maybeSingle();
  if (!campana) return null;
  const envios = await resumenEnvios(s.company_id, campana as CampanaCompleta);

  const [{ data: busquedas }, { data: prospectos }, recuento, { data: usadas }] = await Promise.all([
    db.from("captacion_busquedas")
      .select("id, fuente, zona, estado, encontrados, nuevos, revisar, descartados, error, created_at, terminada_at, cursor")
      .eq("campana_id", id).eq("company_id", s.company_id).order("created_at", { ascending: false }).limit(20),
    db.from("captacion_prospectos")
      .select("id, nombre_negocio, municipio, direccion, telefono_e164, es_movil, telefono_fuente, telefono_url_fuente, prioridad, web, etapa, revisar_motivo, cliente_coincidente_id, lead_coincidente_id")
      .eq("campana_id", id).eq("company_id", s.company_id).eq("etapa", etapa)
      .order("prioridad", { ascending: false }).order("nombre_negocio").limit(200),
    contarPorEtapa(s.company_id, id, [...ETAPAS_MANDO]),
    db.rpc("captacion_llamadas_places_mes"),
  ]);

  return {
    places: { configurado: placesConfigurado(), usadas: (usadas as number | null) ?? 0, tope: topePlacesMensual() },
    campana: campana as CampanaFila,
    envios,
    busquedas: ((busquedas ?? []) as Array<BusquedaFila & { cursor: { i: number; fichas: unknown[] } | null }>).map(
      ({ cursor, ...b }) => ({ ...b, progreso: cursor ? { i: cursor.i, total: cursor.fichas.length } : null }),
    ),
    prospectos: (prospectos ?? []) as ProspectoFila[],
    recuento,
  };
}

// -----------------------------------------------------------------------------
// Escritura
// -----------------------------------------------------------------------------

const zonaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("provincia"), iso: z.string(), nombre: z.string().optional() }),
  z.object({ tipo: z.literal("municipio"), nombre: z.string().trim().min(2).max(80), provincia_iso: z.string() }),
  z.object({ tipo: z.literal("radio"), lat: z.number(), lng: z.number(), km: z.number() }),
]);

const crearSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  tipologia_clave: z.string().min(1).max(40),
  zona: zonaSchema,
});

export async function crearCampanaAction(input: unknown): Promise<Resultado<{ id: string }>> {
  try {
    const s = await sesionGestor();
    const p = crearSchema.parse(input);
    if (!zonaValida(p.zona as Zona)) return { ok: false, error: "La zona no es válida." };
    const db = admin();
    const { data: tip } = await db
      .from("captacion_tipologias")
      .select("clave, etiquetas_osm, terminos_busqueda")
      .eq("clave", p.tipologia_clave)
      .maybeSingle();
    if (!tip) return { ok: false, error: "Ese tipo de negocio no existe." };
    const etiquetas = ((tip as { etiquetas_osm: string[] }).etiquetas_osm ?? []).filter(filtroOsmValido);
    const { data, error } = await db
      .from("captacion_campanas")
      .insert({
        company_id: s.company_id,
        nombre: p.nombre,
        tipologia_clave: p.tipologia_clave,
        etiquetas_osm: etiquetas,
        terminos_busqueda: (tip as { terminos_busqueda: string[] }).terminos_busqueda ?? [],
        zonas: [p.zona],
        created_by: s.user_id,
        responsable_user_id: s.user_id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/captacion/campanas");
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/** Encola una búsqueda por cada zona de la campaña (si no hay ya una en marcha). No busca en caliente. */
export async function buscarNegociosAction(
  campanaId: string,
  fuente: "osm" | "places" = "osm",
): Promise<Resultado<{ creadas: number }>> {
  try {
    const s = await sesionGestor();
    z.string().uuid().parse(campanaId);
    z.enum(["osm", "places"]).parse(fuente);
    if (fuente === "places" && !placesConfigurado()) {
      return { ok: false, error: "Google Places no está configurado en el servidor." };
    }
    const db = admin();
    const { data: camp } = await db
      .from("captacion_campanas")
      .select("id, zonas, estado")
      .eq("id", campanaId)
      .eq("company_id", s.company_id)
      .maybeSingle();
    if (!camp) return { ok: false, error: "Campaña no encontrada." };
    if ((camp as { estado: string }).estado === "terminada") return { ok: false, error: "La campaña está terminada." };

    const { data: enMarcha } = await db
      .from("captacion_busquedas")
      .select("zona")
      .eq("campana_id", campanaId)
      .eq("fuente", fuente)
      .in("estado", ["pendiente", "en_curso"]);
    const ocupadas = new Set(((enMarcha ?? []) as Array<{ zona: Zona }>).map((b) => JSON.stringify(b.zona)));
    const zonas = ((camp as { zonas: Zona[] }).zonas ?? []).filter((z0) => zonaValida(z0) && !ocupadas.has(JSON.stringify(z0)));
    if (zonas.length === 0) return { ok: true, creadas: 0 };

    const { error } = await db.from("captacion_busquedas").insert(
      zonas.map((zona) => ({ company_id: s.company_id, campana_id: campanaId, fuente, zona, created_by: s.user_id })),
    );
    if (error) throw new Error(error.message);
    revalidatePath(`/captacion/campanas/${campanaId}`);
    return { ok: true, creadas: zonas.length };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/** Mismo código que el cron, acotado a esta campaña y a ~45 s. */
export async function procesarAhoraAction(campanaId: string): Promise<Resultado<{ resumen: string }>> {
  try {
    const s = await sesionGestor();
    z.string().uuid().parse(campanaId);
    const r = await procesarColaBusquedas({ presupuestoMs: 45_000, companyId: s.company_id, campanaId });
    revalidatePath(`/captacion/campanas/${campanaId}`);
    const partes = [`${r.fichasLeidas} negocios mirados`, `${r.nuevos} nuevos`, `${r.revisar} para revisar`];
    if (r.duplicados) partes.push(`${r.duplicados} ya estaban`);
    if (r.descartados) partes.push(`${r.descartados} descartados`);
    if (r.errores.length) partes.push(`${r.errores.length} con error`);
    return { ok: true, resumen: r.busquedas === 0 ? "No hay búsquedas pendientes." : partes.join(" · ") };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const marcarSchema = z.object({
  id: z.string().uuid(),
  accion: z.enum(["nuevo", "descartado"]),
});

/**
 * Revisión a mano. Pasar a «nuevo» solo se admite con móvil y sin teléfono
 * de un cliente o lead: a un cliente actual no se le escribe en frío.
 */
export async function marcarProspectoAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionGestor();
    const p = marcarSchema.parse(input);
    const db = admin();
    const { data: pr } = await db
      .from("captacion_prospectos")
      .select("id, campana_id, etapa, telefono_e164, telefono_fuente, revisar_motivo")
      .eq("id", p.id)
      .eq("company_id", s.company_id)
      .maybeSingle();
    if (!pr) return { ok: false, error: "No encontrado." };
    const fila = pr as { campana_id: string | null; etapa: string; telefono_e164: string | null; telefono_fuente: string | null; revisar_motivo: string | null };
    if (!["nuevo", "revisar", "descartado"].includes(fila.etapa)) {
      return { ok: false, error: "Este negocio ya está en marcha; no se cambia desde aquí." };
    }
    if (p.accion === "nuevo") {
      if (!contactablePorWhatsapp({ e164: fila.telefono_e164, whatsapp: fila.telefono_fuente === "whatsapp_web" })) {
        return { ok: false, error: "Sin móvil ni WhatsApp comprobado no se le puede escribir." };
      }
      if (fila.revisar_motivo?.startsWith("Su teléfono ya es")) {
        return { ok: false, error: "Ese teléfono ya es de un cliente o lead: no se le escribe en frío." };
      }
    }
    const { error } = await db
      .from("captacion_prospectos")
      .update(
        p.accion === "nuevo"
          ? { etapa: "nuevo", revisar_motivo: null, descartado_motivo: null }
          : { etapa: "descartado", descartado_motivo: "A mano en la revisión" },
      )
      .eq("id", p.id)
      .eq("company_id", s.company_id);
    if (error) throw new Error(error.message);
    if (fila.campana_id) revalidatePath(`/captacion/campanas/${fila.campana_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// -----------------------------------------------------------------------------
// Envíos (fase 3)
// -----------------------------------------------------------------------------

/**
 * Mete en la cola de envío los negocios «Nuevos» de la campaña. No envía
 * nada: el cron los saca poco a poco, con el tope, el horario y la segunda
 * comprobación de bloqueos (§4.3).
 */
export async function encolarProspectosAction(
  campanaId: string,
): Promise<Resultado<{ encolados: number; bloqueados: number }>> {
  try {
    const s = await sesionGestor();
    z.string().uuid().parse(campanaId);
    const db = admin();
    const { data: camp } = await db
      .from("captacion_campanas")
      .select("id, estado")
      .eq("id", campanaId)
      .eq("company_id", s.company_id)
      .maybeSingle();
    if (!camp) return { ok: false, error: "Campaña no encontrada." };
    if ((camp as { estado: string }).estado === "terminada") return { ok: false, error: "La campaña está terminada." };
    const r = await encolarProspectos(s.company_id, campanaId, s.user_id);
    revalidatePath(`/captacion/campanas/${campanaId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const ritmoSchema = z.object({
  campanaId: z.string().uuid(),
  estado: z.enum(["activa", "pausada"]),
  tope_diario: z.number().int().min(1).max(200),
});

/**
 * Lanza o pausa los envíos de la campaña y fija su tope diario (como mucho
 * 200, decisión de Mario). Al lanzarla por primera vez se apunta lanzada_at:
 * desde ahí cuenta el escalado.
 */
export async function guardarRitmoCampanaAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionGestor();
    const p = ritmoSchema.parse(input);
    const db = admin();
    const { data: camp } = await db
      .from("captacion_campanas")
      .select("id, estado, lanzada_at, pausa_automatica")
      .eq("id", p.campanaId)
      .eq("company_id", s.company_id)
      .maybeSingle();
    const c = camp as { estado: string; lanzada_at: string | null; pausa_automatica: boolean } | null;
    if (!c) return { ok: false, error: "Campaña no encontrada." };
    if (c.estado === "terminada") return { ok: false, error: "La campaña está terminada." };
    const cambios: Record<string, unknown> = { estado: p.estado, tope_diario: p.tope_diario };
    if (p.estado === "activa") {
      if (c.estado !== "activa") {
        // Con la conexión caída o la calidad baja, el cron la volvería a pausar.
        const { data: con } = await db
          .from("captacion_conexiones")
          .select("estado, calidad")
          .eq("company_id", s.company_id)
          .maybeSingle();
        const motivo = motivoPausaConexion(con as { estado: string; calidad: string } | null);
        if (motivo) return { ok: false, error: `No se puede reanudar: ${motivo}` };
      }
      cambios.motivo_pausa = null;
      if (!c.lanzada_at) cambios.lanzada_at = new Date().toISOString();
      // Tras una pausa automática (fase 7): la muestra del cortacircuitos y el
      // escalado cuentan desde ahora. Solo lo hace una persona: nunca se
      // reanuda sola.
      if (c.estado === "pausada" && c.pausa_automatica) {
        cambios.reanudada_at = new Date().toISOString();
        cambios.pausa_automatica = false;
      }
    } else if (c.estado !== "pausada") {
      cambios.motivo_pausa = "Pausada a mano";
      cambios.pausa_automatica = false;
      cambios.pausada_at = new Date().toISOString();
    }
    const { error } = await db
      .from("captacion_campanas")
      .update(cambios)
      .eq("id", p.campanaId)
      .eq("company_id", s.company_id);
    if (error) throw new Error(error.message);
    revalidatePath(`/captacion/campanas/${p.campanaId}`);
    revalidatePath("/captacion/campanas");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
