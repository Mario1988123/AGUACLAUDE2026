"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { createClient as crearClienteSesion } from "@/shared/lib/supabase/server";
import { captacionActiva, esAdminCaptacion } from "./guard";
import { admin } from "./servidor";
import { hayClaveAnthropic, probarAsistente, type ResultadoPrueba } from "./asistente-servidor";
import { MODELOS_IA, modeloValido } from "./asistente-logica";

/**
 * Fase 5: FAQ, documentos, interruptor del asistente, «Devolver al
 * asistente» y chat de prueba. Lecturas con la sesión (la RLS decide);
 * escrituras con el cliente de servicio después de comprobar el rol.
 *  · FAQ y documentos: editan admin y directores; los comerciales leen.
 *  · Interruptor y modelo: solo el administrador (como el resto de ajustes).
 */

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GESTORES = ["company_admin", "commercial_director", "telemarketing_director"];
const LECTORES = [...GESTORES, "sales_rep", "telemarketer"];
const RUTA_FAQ = "/configuracion/captacion/faq";
const RUTA_CONFIG = "/configuracion/captacion";

function tieneRol(s: SessionClaims, roles: string[]): boolean {
  return s.is_superadmin || s.roles.some((r) => roles.includes(r));
}

async function sesionCon(roles: string[], error: string) {
  const s = await requireSession();
  if (!s.company_id) throw new Error("Sin empresa.");
  if (!tieneRol(s, roles)) throw new Error(error);
  if (!(await captacionActiva(s.company_id))) throw new Error("El módulo de captación no está activo.");
  return s as SessionClaims & { company_id: string };
}

const sesionGestor = () => sesionCon(GESTORES, "Solo el administrador y los directores pueden cambiar esto.");

// -----------------------------------------------------------------------------
// Lectura de la pantalla
// -----------------------------------------------------------------------------

export interface FaqVista {
  id: string;
  pregunta: string;
  respuesta: string;
  activa: boolean;
  campanaId: string | null;
}

export interface DocumentoVista {
  id: string;
  titulo: string;
  contenido: string;
  activo: boolean;
}

export interface DatosFaq {
  puedeEditar: boolean;
  faq: FaqVista[];
  documentos: DocumentoVista[];
  campanas: Array<{ id: string; nombre: string }>;
  ia: { activa: boolean; modelo: string; hayClave: boolean };
}

export async function obtenerDatosFaq(): Promise<DatosFaq | null> {
  const s = await requireSession();
  if (!s.company_id || !tieneRol(s, LECTORES) || !(await captacionActiva(s.company_id))) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await crearClienteSesion()) as any;
  const [faq, docs, camps, con] = await Promise.all([
    db
      .from("captacion_faq")
      .select("id, pregunta, respuesta, activa, campana_id")
      .eq("company_id", s.company_id)
      .order("orden")
      .order("created_at"),
    db
      .from("captacion_documentos")
      .select("id, titulo, contenido, activo")
      .eq("company_id", s.company_id)
      .order("orden")
      .order("created_at"),
    admin().from("captacion_campanas").select("id, nombre").eq("company_id", s.company_id).order("nombre"),
    admin().from("captacion_conexiones").select("ia_activa, modelo_ia").eq("company_id", s.company_id).maybeSingle(),
  ]);
  if (faq.error) throw new Error(`No se pudo leer la FAQ: ${faq.error.message}`);
  if (docs.error) throw new Error(`No se pudieron leer los documentos: ${docs.error.message}`);
  const c = con.data as { ia_activa: boolean; modelo_ia: string | null } | null;
  return {
    puedeEditar: tieneRol(s, GESTORES),
    faq: ((faq.data ?? []) as Array<{ id: string; pregunta: string; respuesta: string; activa: boolean; campana_id: string | null }>).map((f) => ({
      id: f.id,
      pregunta: f.pregunta,
      respuesta: f.respuesta,
      activa: f.activa,
      campanaId: f.campana_id,
    })),
    documentos: (docs.data ?? []) as DocumentoVista[],
    campanas: (camps.data ?? []) as Array<{ id: string; nombre: string }>,
    ia: { activa: c?.ia_activa === true, modelo: modeloValido(c?.modelo_ia), hayClave: hayClaveAnthropic() },
  };
}

/** Para /configuracion/captacion: estado del asistente. */
export async function obtenerEstadoAsistente(): Promise<{ activa: boolean; modelo: string; hayClave: boolean; esAdmin: boolean } | null> {
  const s = await requireSession();
  if (!s.company_id || !tieneRol(s, GESTORES) || !(await captacionActiva(s.company_id))) return null;
  const { data } = await admin()
    .from("captacion_conexiones")
    .select("ia_activa, modelo_ia")
    .eq("company_id", s.company_id)
    .maybeSingle();
  const c = data as { ia_activa: boolean; modelo_ia: string | null } | null;
  if (!c) return null;
  return { activa: c.ia_activa, modelo: modeloValido(c.modelo_ia), hayClave: hayClaveAnthropic(), esAdmin: esAdminCaptacion(s) };
}

// -----------------------------------------------------------------------------
// FAQ
// -----------------------------------------------------------------------------

const faqSchema = z.object({
  id: z.string().uuid().nullable(),
  pregunta: z.string().trim().min(3, "La pregunta es muy corta.").max(300),
  respuesta: z.string().trim().min(1, "Falta la respuesta.").max(2000),
  campanaId: z.string().uuid().nullable(),
  activa: z.boolean(),
});

export async function guardarFaqAction(input: unknown): Promise<Resultado<{ id: string }>> {
  try {
    const s = await sesionGestor();
    const p = faqSchema.parse(input);
    const db = admin();
    if (p.campanaId) {
      const { data } = await db.from("captacion_campanas").select("id").eq("company_id", s.company_id).eq("id", p.campanaId).maybeSingle();
      if (!data) return { ok: false, error: "Esa campaña no existe." };
    }
    const fila = { pregunta: p.pregunta, respuesta: p.respuesta, campana_id: p.campanaId, activa: p.activa, updated_by: s.user_id };
    if (p.id) {
      const { data, error } = await db.from("captacion_faq").update(fila).eq("company_id", s.company_id).eq("id", p.id).select("id");
      if (error) throw new Error(error.message);
      if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "No se encontró la pregunta." };
      revalidatePath(RUTA_FAQ);
      return { ok: true, id: p.id };
    }
    const { data: ult } = await db
      .from("captacion_faq")
      .select("orden")
      .eq("company_id", s.company_id)
      .order("orden", { ascending: false })
      .limit(1)
      .maybeSingle();
    const orden = ((ult as { orden: number } | null)?.orden ?? 0) + 10;
    const { data, error } = await db
      .from("captacion_faq")
      .insert({ ...fila, company_id: s.company_id, orden })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath(RUTA_FAQ);
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const idSchema = z.object({ id: z.string().uuid() });

export async function borrarFaqAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionGestor();
    const { id } = idSchema.parse(input);
    const { error } = await admin().from("captacion_faq").delete().eq("company_id", s.company_id).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(RUTA_FAQ);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const moverSchema = z.object({ id: z.string().uuid(), hacia: z.enum(["arriba", "abajo"]) });

async function mover(tabla: "captacion_faq" | "captacion_documentos", companyId: string, id: string, hacia: "arriba" | "abajo") {
  const db = admin();
  const { data, error } = await db.from(tabla).select("id").eq("company_id", companyId).order("orden").order("created_at");
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as Array<{ id: string }>).map((x) => x.id);
  const i = ids.indexOf(id);
  const j = hacia === "arriba" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
  for (let k = 0; k < ids.length; k++) {
    const { error: e } = await db.from(tabla).update({ orden: (k + 1) * 10 }).eq("company_id", companyId).eq("id", ids[k]);
    if (e) throw new Error(e.message);
  }
}

export async function moverFaqAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionGestor();
    const p = moverSchema.parse(input);
    await mover("captacion_faq", s.company_id, p.id, p.hacia);
    revalidatePath(RUTA_FAQ);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// -----------------------------------------------------------------------------
// Documentos
// -----------------------------------------------------------------------------

const documentoSchema = z.object({
  id: z.string().uuid().nullable(),
  titulo: z.string().trim().min(2, "El título es muy corto.").max(120),
  contenido: z.string().trim().min(1, "Falta el texto.").max(20000, "Como mucho 20.000 caracteres por documento."),
  activo: z.boolean(),
});

export async function guardarDocumentoAction(input: unknown): Promise<Resultado<{ id: string }>> {
  try {
    const s = await sesionGestor();
    const p = documentoSchema.parse(input);
    const db = admin();
    const fila = { titulo: p.titulo, contenido: p.contenido, activo: p.activo, updated_by: s.user_id };
    if (p.id) {
      const { data, error } = await db.from("captacion_documentos").update(fila).eq("company_id", s.company_id).eq("id", p.id).select("id");
      if (error) throw new Error(error.message);
      if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "No se encontró el documento." };
      revalidatePath(RUTA_FAQ);
      return { ok: true, id: p.id };
    }
    const { count } = await db.from("captacion_documentos").select("id", { count: "exact", head: true }).eq("company_id", s.company_id);
    if ((count ?? 0) >= 30) return { ok: false, error: "Como mucho 30 documentos. Junta o borra alguno." };
    const { data, error } = await db
      .from("captacion_documentos")
      .insert({ ...fila, company_id: s.company_id, orden: ((count ?? 0) + 1) * 10 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath(RUTA_FAQ);
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function borrarDocumentoAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionGestor();
    const { id } = idSchema.parse(input);
    const { error } = await admin().from("captacion_documentos").delete().eq("company_id", s.company_id).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(RUTA_FAQ);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function moverDocumentoAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionGestor();
    const p = moverSchema.parse(input);
    await mover("captacion_documentos", s.company_id, p.id, p.hacia);
    revalidatePath(RUTA_FAQ);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// -----------------------------------------------------------------------------
// Interruptor y modelo
// -----------------------------------------------------------------------------

const asistenteSchema = z.object({
  activa: z.boolean(),
  modelo: z.string().refine((v) => MODELOS_IA.some((m) => m.id === v), "Modelo no válido."),
});

export async function guardarAsistenteAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionCon(["company_admin"], "Solo el administrador de la empresa puede encender el asistente.");
    const p = asistenteSchema.parse(input);
    if (p.activa && !hayClaveAnthropic()) {
      return { ok: false, error: "Falta la clave de Anthropic en el servidor: el asistente no se puede encender." };
    }
    const db = admin();
    const { data: con } = await db.from("captacion_conexiones").select("estado").eq("company_id", s.company_id).maybeSingle();
    if (!con) return { ok: false, error: "Conecta primero el número de WhatsApp." };
    if (p.activa && (con as { estado: string }).estado !== "activa") {
      return { ok: false, error: "El asistente solo se puede encender con la conexión activa." };
    }
    const { error } = await db
      .from("captacion_conexiones")
      .update({ ia_activa: p.activa, modelo_ia: p.modelo })
      .eq("company_id", s.company_id);
    if (error) throw new Error(error.message);
    revalidatePath(RUTA_CONFIG);
    revalidatePath(RUTA_FAQ);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// -----------------------------------------------------------------------------
// Devolver al asistente
// -----------------------------------------------------------------------------

export async function devolverAlAsistenteAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionCon(LECTORES, "No tienes acceso a la bandeja de captación.");
    const { id } = idSchema.parse(input);
    // Con la RLS: solo quien ve la conversación puede devolverla.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sesion = (await crearClienteSesion()) as any;
    const { data: conv, error } = await sesion
      .from("captacion_conversaciones")
      .select("id, modo, atendida_por, prospecto_id")
      .eq("company_id", s.company_id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const c = conv as {
      modo: string;
      atendida_por: string | null;
      prospecto_id: string | null;
    } | null;
    if (!c) return { ok: false, error: "No se encontró la conversación." };
    if (c.atendida_por && c.atendida_por !== s.user_id && !tieneRol(s, GESTORES)) {
      return { ok: false, error: "La atiende otra persona." };
    }
    if (c.modo === "cerrada") return { ok: false, error: "La conversación está cerrada: pidió que no le escribiéramos." };
    if (c.modo === "ia") return { ok: true };
    const { data: pros } = c.prospecto_id
      ? await admin().from("captacion_prospectos").select("campana_id").eq("company_id", s.company_id).eq("id", c.prospecto_id).maybeSingle()
      : { data: null };
    if (!(pros as { campana_id: string | null } | null)?.campana_id) {
      return { ok: false, error: "El asistente solo atiende a negocios de una campaña." };
    }
    const { data: con } = await admin().from("captacion_conexiones").select("ia_activa").eq("company_id", s.company_id).maybeSingle();
    if (!(con as { ia_activa: boolean } | null)?.ia_activa || !hayClaveAnthropic()) {
      return { ok: false, error: "El asistente está apagado en esta empresa." };
    }
    const { error: eU } = await admin()
      .from("captacion_conversaciones")
      .update({
        modo: "ia",
        atendida_por: null,
        ia_silenciada_at: null,
        ia_silenciada_motivo: null,
        ia_silenciada_por: null,
        ia_devuelta_at: new Date().toISOString(),
      })
      .eq("company_id", s.company_id)
      .eq("id", id)
      .eq("modo", "humano");
    if (eU) throw new Error(eU.message);
    revalidatePath(`/captacion/bandeja/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// -----------------------------------------------------------------------------
// Chat de prueba
// -----------------------------------------------------------------------------

const pruebaSchema = z.object({
  campanaId: z.string().uuid().nullable(),
  mensajes: z
    .array(z.object({ rol: z.enum(["contacto", "asistente"]), texto: z.string().trim().min(1).max(1500) }))
    .min(1)
    .max(30)
    .refine((m) => m.at(-1)?.rol === "contacto", "El último mensaje tiene que ser del contacto."),
});

export async function probarAsistenteAction(input: unknown): Promise<Resultado<{ resultado: ResultadoPrueba }>> {
  try {
    const s = await sesionGestor();
    const p = pruebaSchema.parse(input);
    if (!hayClaveAnthropic()) return { ok: false, error: "Falta la clave de Anthropic en el servidor." };
    if (p.campanaId) {
      const { data } = await admin().from("captacion_campanas").select("id").eq("company_id", s.company_id).eq("id", p.campanaId).maybeSingle();
      if (!data) return { ok: false, error: "Esa campaña no existe." };
    }
    const resultado = await probarAsistente({ companyId: s.company_id, campanaId: p.campanaId, mensajes: p.mensajes });
    return { ok: true, resultado };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
