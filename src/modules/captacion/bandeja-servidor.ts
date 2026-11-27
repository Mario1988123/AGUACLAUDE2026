import "server-only";
import { admin } from "./servidor";
import {
  e164DesdeWaId,
  estadosAnteriores,
  extraerContactosApp,
  extraerEcos,
  extraerEntrantes,
  extraerEstados,
  extraerHistorial,
  type Contacto,
  type MensajeNormalizado,
} from "./bandeja-logica";

/**
 * Bandeja (fase 2): vuelca en captacion_conversaciones y captacion_mensajes lo
 * que llega por webhook. Siempre con el cliente de servicio y con company_id
 * explícito. El resumen de la conversación (último mensaje, no leídos,
 * ventana de 24 h) lo mantiene el trigger de la base.
 */

interface FilaConversacion {
  id: string;
  prospecto_id: string | null;
  bsuid: string | null;
  wa_id: string | null;
  nombre_contacto: string | null;
}

const COLUMNAS_CONV = "id, prospecto_id, bsuid, wa_id, nombre_contacto";

/** Clave estable de un contacto para agrupar (BSUID manda sobre el teléfono). */
function claveContacto(c: Contacto): string {
  return c.bsuid ? `u:${c.bsuid}` : `w:${c.waId}`;
}

async function buscarConversacion(companyId: string, c: Contacto): Promise<FilaConversacion | null> {
  const db = admin();
  if (c.bsuid) {
    const { data, error } = await db
      .from("captacion_conversaciones")
      .select(COLUMNAS_CONV)
      .eq("company_id", companyId)
      .eq("bsuid", c.bsuid)
      .maybeSingle();
    if (error) throw new Error(`No se pudo buscar la conversación: ${error.message}`);
    if (data) return data as FilaConversacion;
  }
  if (c.waId) {
    const { data, error } = await db
      .from("captacion_conversaciones")
      .select(COLUMNAS_CONV)
      .eq("company_id", companyId)
      .eq("wa_id", c.waId)
      .maybeSingle();
    if (error) throw new Error(`No se pudo buscar la conversación: ${error.message}`);
    if (data) return data as FilaConversacion;
  }
  return null;
}

/** Prospecto de la empresa con ese BSUID o ese teléfono, si lo hay. */
async function buscarProspecto(companyId: string, c: Contacto): Promise<string | null> {
  const db = admin();
  if (c.bsuid) {
    const { data } = await db
      .from("captacion_prospectos")
      .select("id")
      .eq("company_id", companyId)
      .eq("bsuid", c.bsuid)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  const tel = e164DesdeWaId(c.waId);
  if (tel) {
    const { data } = await db
      .from("captacion_prospectos")
      .select("id")
      .eq("company_id", companyId)
      .eq("telefono_e164", tel)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  return null;
}

/**
 * Conversación del contacto; la crea si no existe. Completa el BSUID o el
 * teléfono que falte y deja el BSUID también en el prospecto.
 */
export async function conversacionPara(companyId: string, c: Contacto): Promise<string> {
  const db = admin();
  let conv = await buscarConversacion(companyId, c);

  if (!conv) {
    const prospectoId = await buscarProspecto(companyId, c);
    const { data, error } = await db
      .from("captacion_conversaciones")
      .insert({
        company_id: companyId,
        prospecto_id: prospectoId,
        bsuid: c.bsuid,
        wa_id: c.waId,
        telefono_e164: e164DesdeWaId(c.waId),
        nombre_contacto: c.nombre,
        modo: "humano",
      })
      .select(COLUMNAS_CONV)
      .single();
    if (error) {
      // Dos avisos a la vez del mismo contacto: el otro ganó la carrera.
      if ((error as { code?: string }).code === "23505") {
        conv = await buscarConversacion(companyId, c);
        if (conv) return conv.id;
      }
      throw new Error(`No se pudo crear la conversación: ${error.message}`);
    }
    conv = data as FilaConversacion;
  } else {
    const cambios: Record<string, unknown> = {};
    if (!conv.bsuid && c.bsuid) cambios.bsuid = c.bsuid;
    if (!conv.wa_id && c.waId) {
      cambios.wa_id = c.waId;
      cambios.telefono_e164 = e164DesdeWaId(c.waId);
    }
    if (!conv.nombre_contacto && c.nombre) cambios.nombre_contacto = c.nombre;
    if (!conv.prospecto_id) {
      const p = await buscarProspecto(companyId, c);
      if (p) cambios.prospecto_id = p;
    }
    if (Object.keys(cambios).length > 0) {
      const { error } = await db.from("captacion_conversaciones").update(cambios).eq("id", conv.id);
      // Un choque de unicidad aquí no debe perder el mensaje: se sigue.
      if (error && (error as { code?: string }).code !== "23505") {
        throw new Error(`No se pudo actualizar la conversación: ${error.message}`);
      }
      if (typeof cambios.prospecto_id === "string") conv.prospecto_id = cambios.prospecto_id;
    }
  }

  if (conv.prospecto_id && c.bsuid) {
    // Best effort: el índice único de prospectos puede chocar y no pasa nada.
    await db
      .from("captacion_prospectos")
      .update({ bsuid: c.bsuid })
      .eq("id", conv.prospecto_id)
      .eq("company_id", companyId)
      .is("bsuid", null);
  }
  return conv.id;
}

/** Guarda mensajes agrupados por contacto. Devuelve cuántos eran nuevos. */
export async function guardarMensajes(companyId: string, mensajes: MensajeNormalizado[]): Promise<number> {
  if (mensajes.length === 0) return 0;
  const db = admin();
  const grupos = new Map<string, MensajeNormalizado[]>();
  for (const m of mensajes) {
    const k = claveContacto(m.contacto);
    grupos.set(k, [...(grupos.get(k) ?? []), m]);
  }

  let nuevos = 0;
  for (const grupo of grupos.values()) {
    // El que más datos trae del contacto (nombre, BSUID y teléfono).
    const contacto = grupo.reduce<Contacto>(
      (acc, m) => ({
        waId: acc.waId ?? m.contacto.waId,
        bsuid: acc.bsuid ?? m.contacto.bsuid,
        nombre: acc.nombre ?? m.contacto.nombre,
      }),
      { waId: null, bsuid: null, nombre: null },
    );
    const conversacionId = await conversacionPara(companyId, contacto);
    const filas = [...grupo]
      .sort((a, b) => a.metaAt.localeCompare(b.metaAt))
      .map((m) => ({
        company_id: companyId,
        conversacion_id: conversacionId,
        direccion: m.direccion,
        autor: m.autor,
        origen: m.origen,
        tipo: m.tipo,
        cuerpo: m.cuerpo,
        payload_boton: m.payloadBoton,
        media_id_meta: m.media?.id ?? null,
        media_mime: m.media?.mime ?? null,
        media_nombre: m.media?.nombre ?? null,
        wamid: m.wamid,
        responde_a_wamid: m.respondeA,
        estado: m.estado,
        meta_at: m.metaAt,
      }));
    // Por tandas: el historial puede traer cientos de mensajes de un hilo.
    for (let i = 0; i < filas.length; i += 200) {
      const { data, error } = await db
        .from("captacion_mensajes")
        .upsert(filas.slice(i, i + 200), { onConflict: "wamid", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`No se pudieron guardar los mensajes: ${error.message}`);
      nuevos += ((data ?? []) as unknown[]).length;
    }
  }
  return nuevos;
}

/** Estados de entrega, solo hacia delante. Un wamid que no es nuestro se ignora. */
export async function aplicarEstados(companyId: string, value: unknown): Promise<void> {
  const db = admin();
  for (const s of extraerEstados(value)) {
    const { error } = await db
      .from("captacion_mensajes")
      .update({ estado: s.estado, error_codigo: s.errorCodigo, error_texto: s.errorTexto?.slice(0, 500) ?? null })
      .eq("company_id", companyId)
      .eq("wamid", s.wamid)
      .in("estado", estadosAnteriores(s.estado));
    if (error) throw new Error(`No se pudo actualizar el estado: ${error.message}`);
  }
}

/** Webhook `messages`: entrantes y estados. */
export async function procesarMessages(companyId: string, value: unknown): Promise<void> {
  await guardarMensajes(companyId, extraerEntrantes(value));
  await aplicarEstados(companyId, value);
}

/** Webhook `smb_message_echoes` (coexistencia): lo escrito en la app del móvil. */
export async function procesarEcos(companyId: string, value: unknown): Promise<void> {
  const { mensajes, cambios } = extraerEcos(value);
  await guardarMensajes(companyId, mensajes);
  const db = admin();
  for (const c of cambios) {
    const { error } = await db
      .from("captacion_mensajes")
      .update(c.accion === "borrar" ? { cuerpo: "Mensaje eliminado", tipo: "otro" } : { cuerpo: c.cuerpoNuevo })
      .eq("company_id", companyId)
      .eq("wamid", c.wamidOriginal);
    if (error) throw new Error(`No se pudo aplicar la edición: ${error.message}`);
  }
}

/** Webhook `history` (coexistencia). Puede ser grande: se llama fuera de la respuesta. */
export async function procesarHistorial(companyId: string, value: unknown): Promise<void> {
  const { data: con } = await admin()
    .from("captacion_conexiones")
    .select("numero_e164")
    .eq("company_id", companyId)
    .maybeSingle();
  const numero = (con as { numero_e164: string | null } | null)?.numero_e164 ?? null;
  if (!numero) throw new Error("Sin número del negocio: no se puede saber quién escribió cada mensaje.");
  const { mensajes } = extraerHistorial(value, numero.replace(/^\+/, ""));
  await guardarMensajes(companyId, mensajes);
}

/**
 * Webhook `smb_app_state_sync` (coexistencia): el nombre con el que el negocio
 * tiene guardado al contacto en el móvil manda sobre el nombre de perfil. Solo
 * se toca lo que ya es conversación: no se crea una por cada contacto.
 */
export async function procesarContactosApp(companyId: string, value: unknown): Promise<void> {
  const db = admin();
  for (const c of extraerContactosApp(value)) {
    if (c.accion !== "add" || !c.nombre) continue;
    const conv = await buscarConversacion(companyId, c);
    if (!conv) continue;
    const { error } = await db
      .from("captacion_conversaciones")
      .update({ nombre_contacto: c.nombre })
      .eq("id", conv.id);
    if (error) throw new Error(`No se pudo guardar el nombre: ${error.message}`);
  }
}
