"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { createClient as crearClienteSesion } from "@/shared/lib/supabase/server";
import { captacionActiva } from "./guard";
import { admin, obtenerToken } from "./servidor";
import { enviarTexto, ErrorMeta } from "./meta";
import { validarTextoSaliente, ventanaAbierta } from "./bandeja-logica";

/**
 * Bandeja de captación (fase 2). Las LECTURAS van con el cliente de la sesión,
 * así que la RLS decide qué conversaciones ve cada uno (gestores, todas;
 * comerciales, las que atienden o las de sus prospectos). Las ESCRITURAS van
 * con el cliente de servicio, después de comprobar con la RLS que la
 * conversación es visible para quien escribe.
 */

const ROLES_BANDEJA = [
  "company_admin",
  "commercial_director",
  "telemarketing_director",
  "sales_rep",
  "telemarketer",
];
const GESTORES = ["company_admin", "commercial_director", "telemarketing_director"];

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type FiltroBandeja = "sin_atender" | "mias" | "todas";

export interface ConversacionLista {
  id: string;
  nombre: string;
  telefono: string | null;
  extracto: string | null;
  ultimaDireccion: "entrante" | "saliente" | null;
  ultimoAt: string | null;
  noLeidos: number;
  atendidaPorMi: boolean;
  sinAtender: boolean;
}

export interface MensajeVista {
  id: string;
  direccion: "entrante" | "saliente";
  autor: "contacto" | "ia" | "humano" | "sistema";
  origen: "api" | "movil" | "historial";
  tipo: string;
  cuerpo: string | null;
  mediaNombre: string | null;
  estado: "recibido" | "enviado" | "entregado" | "leido" | "fallido";
  errorTexto: string | null;
  metaAt: string;
}

export interface ConversacionDetalle {
  id: string;
  nombre: string;
  telefono: string | null;
  negocio: string | null;
  prospectoId: string | null;
  ventanaHasta: string | null;
  ventanaAbierta: boolean;
  atendidaPorMi: boolean;
  sinAtender: boolean;
  coexistencia: boolean;
  conexionActiva: boolean;
  mensajes: MensajeVista[];
  /** true si hay más mensajes antiguos que los que se enseñan. */
  hayMas: boolean;
}

function puedeBandeja(s: SessionClaims): boolean {
  return s.is_superadmin || s.roles.some((r) => ROLES_BANDEJA.includes(r));
}
function esGestor(s: SessionClaims): boolean {
  return s.is_superadmin || s.roles.some((r) => GESTORES.includes(r));
}

async function sesionBandeja() {
  const s = await requireSession();
  if (!s.company_id) throw new Error("Sin empresa.");
  if (!puedeBandeja(s)) throw new Error("No tienes acceso a la bandeja de captación.");
  if (!(await captacionActiva(s.company_id))) throw new Error("El módulo de captación no está activo.");
  return s as SessionClaims & { company_id: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clienteSesion(): Promise<any> {
  return crearClienteSesion();
}

function nombreDe(c: {
  nombre_contacto: string | null;
  telefono_e164: string | null;
  captacion_prospectos?: { nombre_negocio: string | null } | null;
}): string {
  return c.captacion_prospectos?.nombre_negocio ?? c.nombre_contacto ?? c.telefono_e164 ?? "Contacto sin nombre";
}

// -----------------------------------------------------------------------------
// Lectura
// -----------------------------------------------------------------------------

export async function listarConversaciones(
  filtro: FiltroBandeja,
): Promise<{ conversaciones: ConversacionLista[]; esGestor: boolean } | null> {
  const s = await requireSession();
  if (!s.company_id || !puedeBandeja(s) || !(await captacionActiva(s.company_id))) return null;
  const db = await clienteSesion();
  let q = db
    .from("captacion_conversaciones")
    .select(
      "id, nombre_contacto, telefono_e164, ultimo_extracto, ultima_direccion, ultimo_mensaje_at, no_leidos, atendida_por, captacion_prospectos(nombre_negocio)",
    )
    .eq("company_id", s.company_id)
    .neq("modo", "cerrada")
    .order("ultimo_mensaje_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (filtro === "sin_atender") q = q.is("atendida_por", null);
  if (filtro === "mias") q = q.eq("atendida_por", s.user_id);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudo leer la bandeja: ${error.message}`);

  const conversaciones = ((data ?? []) as Array<{
    id: string;
    nombre_contacto: string | null;
    telefono_e164: string | null;
    ultimo_extracto: string | null;
    ultima_direccion: "entrante" | "saliente" | null;
    ultimo_mensaje_at: string | null;
    no_leidos: number;
    atendida_por: string | null;
    captacion_prospectos: { nombre_negocio: string | null } | null;
  }>).map((c) => ({
    id: c.id,
    nombre: nombreDe(c),
    telefono: c.telefono_e164,
    extracto: c.ultimo_extracto,
    ultimaDireccion: c.ultima_direccion,
    ultimoAt: c.ultimo_mensaje_at,
    noLeidos: c.no_leidos,
    atendidaPorMi: c.atendida_por === s.user_id,
    sinAtender: c.atendida_por == null,
  }));
  return { conversaciones, esGestor: esGestor(s) };
}

const MAX_MENSAJES = 300;

/** Conversación visible para la sesión (RLS) con sus últimos mensajes. La marca como leída. */
export async function obtenerConversacion(id: string): Promise<ConversacionDetalle | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const s = await requireSession();
  if (!s.company_id || !puedeBandeja(s) || !(await captacionActiva(s.company_id))) return null;
  const db = await clienteSesion();

  const { data: c, error } = await db
    .from("captacion_conversaciones")
    .select(
      "id, prospecto_id, nombre_contacto, telefono_e164, ventana_hasta, atendida_por, no_leidos, captacion_prospectos(nombre_negocio)",
    )
    .eq("id", id)
    .eq("company_id", s.company_id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  if (!c) return null;

  const [{ data: filas, error: eM }, { data: con }] = await Promise.all([
    db
      .from("captacion_mensajes")
      .select("id, direccion, autor, origen, tipo, cuerpo, media_nombre, estado, error_texto, meta_at")
      .eq("conversacion_id", id)
      .order("meta_at", { ascending: false })
      .limit(MAX_MENSAJES + 1),
    admin()
      .from("captacion_conexiones")
      .select("estado, coexistencia")
      .eq("company_id", s.company_id)
      .maybeSingle(),
  ]);
  if (eM) throw new Error(`No se pudieron leer los mensajes: ${eM.message}`);

  const lista = (filas ?? []) as Array<{
    id: string;
    direccion: MensajeVista["direccion"];
    autor: MensajeVista["autor"];
    origen: MensajeVista["origen"];
    tipo: string;
    cuerpo: string | null;
    media_nombre: string | null;
    estado: MensajeVista["estado"];
    error_texto: string | null;
    meta_at: string;
  }>;
  const hayMas = lista.length > MAX_MENSAJES;
  const mensajes = lista
    .slice(0, MAX_MENSAJES)
    .reverse()
    .map((m) => ({
      id: m.id,
      direccion: m.direccion,
      autor: m.autor,
      origen: m.origen,
      tipo: m.tipo,
      cuerpo: m.cuerpo,
      mediaNombre: m.media_nombre,
      estado: m.estado,
      errorTexto: m.error_texto,
      metaAt: m.meta_at,
    }));

  const conv = c as {
    id: string;
    prospecto_id: string | null;
    nombre_contacto: string | null;
    telefono_e164: string | null;
    ventana_hasta: string | null;
    atendida_por: string | null;
    no_leidos: number;
    captacion_prospectos: { nombre_negocio: string | null } | null;
  };
  if (conv.no_leidos > 0) {
    await admin()
      .from("captacion_conversaciones")
      .update({ no_leidos: 0 })
      .eq("id", id)
      .eq("company_id", s.company_id);
  }
  const conexion = con as { estado: string; coexistencia: boolean } | null;

  return {
    id: conv.id,
    nombre: nombreDe(conv),
    telefono: conv.telefono_e164,
    negocio: conv.captacion_prospectos?.nombre_negocio ?? null,
    prospectoId: conv.prospecto_id,
    ventanaHasta: conv.ventana_hasta,
    ventanaAbierta: ventanaAbierta(conv.ventana_hasta),
    atendidaPorMi: conv.atendida_por === s.user_id,
    sinAtender: conv.atendida_por == null,
    coexistencia: conexion?.coexistencia === true,
    conexionActiva: conexion?.estado === "activa",
    mensajes,
    hayMas,
  };
}

// -----------------------------------------------------------------------------
// Escritura
// -----------------------------------------------------------------------------

/** Comprueba con la RLS que la sesión ve la conversación. */
async function conversacionVisible(id: string, companyId: string) {
  const db = await clienteSesion();
  const { data, error } = await db
    .from("captacion_conversaciones")
    .select("id, wa_id, bsuid, ventana_hasta, atendida_por, modo")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    wa_id: string | null;
    bsuid: string | null;
    ventana_hasta: string | null;
    atendida_por: string | null;
    modo: string;
  } | null;
}

const enviarSchema = z.object({
  conversacionId: z.string().uuid(),
  texto: z.string().max(5000),
});

function rutaConversacion(id: string) {
  return `/captacion/bandeja/${id}`;
}

export async function enviarMensajeAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionBandeja();
    const p = enviarSchema.parse(input);
    const v = validarTextoSaliente(p.texto);
    if (!v.ok) return { ok: false, error: v.error };

    const conv = await conversacionVisible(p.conversacionId, s.company_id);
    if (!conv) return { ok: false, error: "No tienes acceso a esta conversación." };
    if (!ventanaAbierta(conv.ventana_hasta)) {
      return {
        ok: false,
        error: "Han pasado más de 24 h desde su último mensaje: WhatsApp solo deja enviar una plantilla aprobada.",
      };
    }
    if (!conv.wa_id && !conv.bsuid) {
      return { ok: false, error: "Este contacto no tiene teléfono ni identificador de WhatsApp." };
    }

    const db = admin();
    const { data: con } = await db
      .from("captacion_conexiones")
      .select("estado, phone_number_id")
      .eq("company_id", s.company_id)
      .maybeSingle();
    const conexion = con as { estado: string; phone_number_id: string | null } | null;
    if (conexion?.estado !== "activa" || !conexion.phone_number_id) {
      return { ok: false, error: "El número de WhatsApp no está conectado." };
    }
    const token = await obtenerToken(s.company_id);
    if (!token) return { ok: false, error: "Falta el acceso a Meta: vuelve a conectar el número." };

    let wamid: string;
    try {
      wamid = await enviarTexto(token, conexion.phone_number_id, { waId: conv.wa_id, bsuid: conv.bsuid }, v.texto);
    } catch (e) {
      if (e instanceof ErrorMeta && e.codigo === 131047) {
        return { ok: false, error: "WhatsApp dice que la ventana de 24 h está cerrada: solo se puede enviar una plantilla." };
      }
      if (e instanceof ErrorMeta) return { ok: false, error: `Meta: ${e.message}` };
      throw e;
    }

    const { error: eIns } = await db.from("captacion_mensajes").insert({
      company_id: s.company_id,
      conversacion_id: conv.id,
      direccion: "saliente",
      autor: "humano",
      origen: "api",
      usuario_id: s.user_id,
      tipo: "texto",
      cuerpo: v.texto,
      wamid,
      estado: "enviado",
      meta_at: new Date().toISOString(),
    });
    // El mensaje ya ha salido: si no se puede apuntar, se dice, pero no se repite.
    if (eIns) return { ok: false, error: `Enviado, pero no se pudo guardar aquí: ${eIns.message}` };

    // Quien contesta se queda la conversación si estaba sin atender.
    if (!conv.atendida_por || conv.modo !== "humano") {
      await db
        .from("captacion_conversaciones")
        .update({ atendida_por: conv.atendida_por ?? s.user_id, modo: "humano" })
        .eq("id", conv.id)
        .eq("company_id", s.company_id);
    }
    revalidatePath(rutaConversacion(conv.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/** «Atender»: la conversación pasa a ser de quien la pulsa (o la suelta). */
export async function atenderConversacionAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionBandeja();
    const p = z.object({ conversacionId: z.string().uuid(), soltar: z.boolean().optional() }).parse(input);
    const conv = await conversacionVisible(p.conversacionId, s.company_id);
    if (!conv) return { ok: false, error: "No tienes acceso a esta conversación." };
    if (!p.soltar && conv.atendida_por && conv.atendida_por !== s.user_id && !esGestor(s)) {
      return { ok: false, error: "Ya la atiende otra persona." };
    }
    if (p.soltar && conv.atendida_por !== s.user_id && !esGestor(s)) {
      return { ok: false, error: "Solo puede soltarla quien la atiende." };
    }
    const { error } = await admin()
      .from("captacion_conversaciones")
      .update({ atendida_por: p.soltar ? null : s.user_id })
      .eq("id", conv.id)
      .eq("company_id", s.company_id);
    if (error) throw new Error(error.message);
    revalidatePath(rutaConversacion(conv.id));
    revalidatePath("/captacion/bandeja");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
