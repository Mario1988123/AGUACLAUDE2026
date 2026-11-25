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
    .select("id, nombre, estado, tipologia_clave, zonas, created_at")
    .eq("id", id)
    .eq("company_id", s.company_id)
    .maybeSingle();
  if (!campana) return null;

  const [{ data: busquedas }, { data: prospectos }, recuento, { data: usadas }] = await Promise.all([
    db.from("captacion_busquedas")
      .select("id, fuente, zona, estado, encontrados, nuevos, revisar, descartados, error, created_at, terminada_at, cursor")
      .eq("campana_id", id).eq("company_id", s.company_id).order("created_at", { ascending: false }).limit(20),
    db.from("captacion_prospectos")
      .select("id, nombre_negocio, municipio, direccion, telefono_e164, es_movil, telefono_fuente, telefono_url_fuente, prioridad, web, etapa, revisar_motivo, cliente_coincidente_id, lead_coincidente_id")
      .eq("campana_id", id).eq("company_id", s.company_id).eq("etapa", etapa)
      .order("prioridad", { ascending: false }).order("nombre_negocio").limit(200),
    contarPorEtapa(s.company_id, id, ["nuevo", "revisar", "descartado"]),
    db.rpc("captacion_llamadas_places_mes"),
  ]);

  return {
    places: { configurado: placesConfigurado(), usadas: (usadas as number | null) ?? 0, tope: topePlacesMensual() },
    campana: campana as CampanaFila,
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
