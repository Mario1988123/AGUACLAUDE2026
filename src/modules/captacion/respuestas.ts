import "server-only";
import { after } from "next/server";
import { admin, obtenerToken } from "./servidor";
import { enviarBotones, enviarTexto } from "./meta";
import { conversacionPara } from "./bandeja-servidor";
import { debeReabrirConversacion, e164DesdeWaId, type MensajeNormalizado } from "./bandeja-logica";
import { cargaBoton, clasificarRespuesta } from "./envios-logica";
import { cancelarEnviosPendientes, contactoBloqueado } from "./envios-servidor";
import { referenciaEnTexto } from "./propuesta-logica";
import { destinoDeConversacion, mandarPropuesta, PropuestaSinVentana } from "./propuesta-envio";
import {
  cargarEmpresaPropuesta,
  crearPropuesta,
  guardarPdf,
  propuestaPorReferencia,
  SinEquipos,
} from "./propuesta-servidor";
import { generarPdfPropuesta } from "./pdf-propuesta";
import { avisarResponsable } from "./avisos";
import { asistenteTrasTexto } from "./asistente-servidor";

/**
 * Respuestas a la plantilla (plan §4.4 y decisión 8: MVP sin IA, solo
 * botones). Se llama desde el webhook `messages`, después de guardar los
 * mensajes en la bandeja. Cada camino es idempotente: Meta reenvía y el cron
 * reintenta los eventos que fallan.
 *
 *  · «No» (botón o baja por texto) → bloqueo del teléfono y del BSUID,
 *    envíos pendientes cancelados, prospecto `descartado`, conversación
 *    `cerrada` y una línea de cortesía.
 *  · «Sí» → recordatorio cancelado, prospecto `interesado`, lead creado en la
 *    bolsa común (decisión 4) y botones [Que me llaméis] [Ahora no].
 *    alDecirSi() es el punto de enganche de la fase 4 (PDF).
 *  · [Que me llaméis] → lead prioritario. [Ahora no] → solo queda guardado.
 *  · Texto libre → se queda en la bandeja; cancela el recordatorio.
 */

export const TEXTO_CORTESIA_NO = "Entendido, no volveremos a escribirte. Gracias.";
export const TEXTO_CORTESIA_LLAMADA = "Perfecto, te llamaremos en cuanto podamos. Gracias.";
const BOTON_LLAMAR = "Que me llaméis";
const BOTON_AHORA_NO = "Ahora no";

/** Etapas en las que una baja por texto bloquea sola (el prospecto está en una campaña). */
const ETAPAS_BAJA_POR_TEXTO = [
  "en_cola",
  "contactado",
  "recordado",
  "interesado",
  "conversando",
  "caliente",
  "sin_respuesta",
];

/** Etapas desde las que un «Sí» pasa a «interesado». */
const ETAPAS_ANTES_DE_SI = ["en_cola", "contactado", "recordado", "conversando", "sin_respuesta"];

interface ProspectoRespuesta {
  id: string;
  campana_id: string | null;
  nombre_negocio: string;
  telefono_e164: string | null;
  bsuid: string | null;
  email: string | null;
  web: string | null;
  direccion: string | null;
  municipio: string | null;
  codigo_postal: string | null;
  etapa: string;
  lead_id: string | null;
}

const COLUMNAS_PROSPECTO =
  "id, campana_id, nombre_negocio, telefono_e164, bsuid, email, web, direccion, municipio, codigo_postal, etapa, lead_id";

export interface ContextoRespuesta {
  companyId: string;
  conversacionId: string;
  mensaje: MensajeNormalizado;
  prospecto: ProspectoRespuesta | null;
  envioId: string | null;
}

async function leerProspecto(companyId: string, id: string | null): Promise<ProspectoRespuesta | null> {
  if (!id) return null;
  const { data, error } = await admin()
    .from("captacion_prospectos")
    .select(COLUMNAS_PROSPECTO)
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el prospecto: ${error.message}`);
  return (data as ProspectoRespuesta | null) ?? null;
}

async function envioPor(companyId: string, campo: "id" | "wamid", valor: string) {
  const { data, error } = await admin()
    .from("captacion_envios")
    .select("id, prospecto_id")
    .eq("company_id", companyId)
    .eq(campo, valor)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el envío: ${error.message}`);
  return data as { id: string; prospecto_id: string } | null;
}

/**
 * Identifica al contacto por este orden (§4.4): la carga del botón o el
 * context.id (el wamid de nuestra plantilla) → envío → prospecto; si no, el
 * prospecto de la conversación (BSUID o teléfono).
 */
async function contextoDe(
  companyId: string,
  m: MensajeNormalizado,
  carga: { accion: string; id: string } | null,
): Promise<ContextoRespuesta> {
  const db = admin();
  const conversacionId = await conversacionPara(companyId, m.contacto);
  let envio: { id: string; prospecto_id: string } | null = null;
  let prospectoId: string | null = null;

  if (carga && (carga.accion === "si" || carga.accion === "no")) envio = await envioPor(companyId, "id", carga.id);
  if (!envio && m.respondeA) envio = await envioPor(companyId, "wamid", m.respondeA);
  if (envio) prospectoId = envio.prospecto_id;
  if (!prospectoId && carga && (carga.accion === "llamar" || carga.accion === "ahora_no")) prospectoId = carga.id;
  if (!prospectoId) {
    const { data } = await db
      .from("captacion_conversaciones")
      .select("prospecto_id")
      .eq("company_id", companyId)
      .eq("id", conversacionId)
      .maybeSingle();
    prospectoId = (data as { prospecto_id: string | null } | null)?.prospecto_id ?? null;
  }
  const prospecto = await leerProspecto(companyId, prospectoId);

  if (prospecto) {
    // Enlaza la conversación con el prospecto y guarda el BSUID (best effort).
    await db
      .from("captacion_conversaciones")
      .update({ prospecto_id: prospecto.id })
      .eq("company_id", companyId)
      .eq("id", conversacionId)
      .is("prospecto_id", null);
    if (m.contacto.bsuid && !prospecto.bsuid) {
      await db
        .from("captacion_prospectos")
        .update({ bsuid: m.contacto.bsuid })
        .eq("company_id", companyId)
        .eq("id", prospecto.id)
        .is("bsuid", null);
    }
  }
  return { companyId, conversacionId, mensaje: m, prospecto, envioId: envio?.id ?? null };
}

/** Webhook `messages` → respuestas. Solo entrantes de la API. */
export async function procesarRespuestas(companyId: string, mensajes: MensajeNormalizado[]): Promise<void> {
  for (const m of mensajes) {
    if (m.direccion !== "entrante" || m.origen !== "api") continue;
    const r = clasificarRespuesta(m);
    const carga = r.clase === "boton" ? { accion: r.accion, id: r.id } : null;
    const ctx = await contextoDe(companyId, m, carga);

    // Fase 8: si vuelve a escribir alguien con la conversación cerrada y no
    // está bloqueado, se reabre para que lo atienda una persona.
    const cierra =
      (r.clase === "boton" && r.accion === "no") ||
      (r.clase === "baja" && Boolean(ctx.prospecto && ETAPAS_BAJA_POR_TEXTO.includes(ctx.prospecto.etapa)));
    await reabrirSiProcede(ctx, cierra);

    if (r.clase === "baja") {
      // Con coexistencia el número es también el WhatsApp normal de la empresa:
      // un cliente que contesta «no» en otra conversación no se bloquea solo.
      // La baja por texto automática es para quien está en una campaña.
      if (ctx.prospecto && ETAPAS_BAJA_POR_TEXTO.includes(ctx.prospecto.etapa)) await alDecirNo(ctx, "baja_texto");
      else await alEscribirLibre(ctx);
    }
    else if (r.clase === "boton" && r.accion === "no") await alDecirNo(ctx, "boton_no");
    else if (r.clase === "boton" && r.accion === "si") await alDecirSi(ctx);
    else if (r.clase === "boton" && r.accion === "llamar") await alPedirLlamada(ctx);
    else if (r.clase === "boton" && r.accion === "ahora_no") {
      // [Ahora no]: no se hace nada más que guardarlo (ya está en la bandeja).
    } else await alEscribirLibre(ctx);
  }
}

/** Reabre (modo `humano`) una conversación cerrada si el contacto no está bloqueado. Nunca lanza. */
async function reabrirSiProcede(ctx: ContextoRespuesta, cierraEsteMensaje: boolean): Promise<void> {
  if (cierraEsteMensaje) return;
  try {
    const db = admin();
    const { data } = await db
      .from("captacion_conversaciones")
      .select("modo, telefono_e164, bsuid")
      .eq("company_id", ctx.companyId)
      .eq("id", ctx.conversacionId)
      .maybeSingle();
    const c = data as { modo: string; telefono_e164: string | null; bsuid: string | null } | null;
    if (c?.modo !== "cerrada") return;
    const telefono = c.telefono_e164 ?? ctx.prospecto?.telefono_e164 ?? e164DesdeWaId(ctx.mensaje.contacto.waId);
    const bsuid = c.bsuid ?? ctx.mensaje.contacto.bsuid ?? ctx.prospecto?.bsuid ?? null;
    // contactoBloqueado ya da «bloqueado» si no puede comprobarlo.
    const bloqueado = await contactoBloqueado(ctx.companyId, telefono, bsuid);
    if (!debeReabrirConversacion({ modo: c.modo, bloqueado, cierraEsteMensaje })) return;
    const { error } = await db
      .from("captacion_conversaciones")
      .update({ modo: "humano" })
      .eq("company_id", ctx.companyId)
      .eq("id", ctx.conversacionId)
      .eq("modo", "cerrada");
    if (error) console.error("[captacion/respuestas] reabrir:", error.message);
  } catch (e) {
    console.error("[captacion/respuestas] reabrir:", e instanceof Error ? e.message : e);
  }
}

// -----------------------------------------------------------------------------
// Envío de respuestas dentro de la ventana
// -----------------------------------------------------------------------------

async function conexionDe(companyId: string): Promise<{ token: string; phoneNumberId: string } | null> {
  const { data } = await admin()
    .from("captacion_conexiones")
    .select("estado, phone_number_id")
    .eq("company_id", companyId)
    .maybeSingle();
  const c = data as { estado: string; phone_number_id: string | null } | null;
  if (c?.estado !== "activa" || !c.phone_number_id) return null;
  const token = await obtenerToken(companyId);
  return token ? { token, phoneNumberId: c.phone_number_id } : null;
}

async function guardarSaliente(
  ctx: ContextoRespuesta,
  wamid: string,
  tipo: "texto" | "boton" | "documento",
  cuerpo: string,
  medio?: { id: string | null; mime: string; nombre: string },
): Promise<void> {
  const { error } = await admin().from("captacion_mensajes").insert({
    company_id: ctx.companyId,
    conversacion_id: ctx.conversacionId,
    direccion: "saliente",
    autor: "sistema",
    origen: "api",
    tipo,
    cuerpo,
    wamid,
    estado: "enviado",
    meta_at: new Date().toISOString(),
    ...(medio ? { media_id_meta: medio.id, media_mime: medio.mime, media_nombre: medio.nombre } : {}),
  });
  if (error) console.error("[captacion/respuestas] enviado pero no guardado", error.message);
}

/** Texto de servicio (gratis dentro de la ventana). Nunca lanza: se registra y sigue. */
async function responderTexto(ctx: ContextoRespuesta, texto: string): Promise<void> {
  try {
    const con = await conexionDe(ctx.companyId);
    if (!con) return;
    const destino = { waId: ctx.mensaje.contacto.waId, bsuid: ctx.mensaje.contacto.bsuid };
    const wamid = await enviarTexto(con.token, con.phoneNumberId, destino, texto);
    await guardarSaliente(ctx, wamid, "texto", texto);
  } catch (e) {
    console.error("[captacion/respuestas] no se pudo contestar", e instanceof Error ? e.message : e);
  }
}

// -----------------------------------------------------------------------------
// «No» y baja por texto
// -----------------------------------------------------------------------------

export async function alDecirNo(ctx: ContextoRespuesta, motivo: "boton_no" | "baja_texto"): Promise<void> {
  const db = admin();
  const { companyId, prospecto, mensaje: m } = ctx;
  const telefono = prospecto?.telefono_e164 ?? e164DesdeWaId(m.contacto.waId);
  const bsuid = m.contacto.bsuid ?? prospecto?.bsuid ?? null;

  // 1) Bloqueo (teléfono y BSUID). El índice único hace que repetir no duplique.
  const filas = [
    telefono ? { ambito: "telefono", valor: telefono } : null,
    bsuid ? { ambito: "bsuid", valor: bsuid } : null,
  ]
    .filter(Boolean)
    .map((f) => ({ ...f, company_id: companyId, motivo, prospecto_id: prospecto?.id ?? null, origen_wamid: m.wamid }));
  if (filas.length > 0) {
    const { error } = await db
      .from("captacion_bloqueos")
      .upsert(filas, { onConflict: "company_id,ambito,valor", ignoreDuplicates: true });
    if (error) throw new Error(`No se pudo bloquear: ${error.message}`);
  }

  // 2) y 3) Envíos pendientes fuera y prospecto descartado.
  let cambio = false;
  if (prospecto) {
    await cancelarEnviosPendientes(companyId, prospecto.id, motivo === "boton_no" ? "Dijo «No»" : "Pidió la baja");
    const { data, error } = await db
      .from("captacion_prospectos")
      .update({
        etapa: "descartado",
        descartado_motivo: motivo === "boton_no" ? "Pulsó «No, gracias»" : "Pidió la baja por escrito",
      })
      .eq("company_id", companyId)
      .eq("id", prospecto.id)
      .neq("etapa", "descartado")
      .select("id");
    if (error) throw new Error(error.message);
    cambio = ((data ?? []) as unknown[]).length > 0;
  }

  // 4) Conversación cerrada.
  const { data: conv, error: eConv } = await db
    .from("captacion_conversaciones")
    .update({ modo: "cerrada" })
    .eq("company_id", companyId)
    .eq("id", ctx.conversacionId)
    .neq("modo", "cerrada")
    .select("id");
  if (eConv) throw new Error(eConv.message);
  cambio = cambio || ((conv ?? []) as unknown[]).length > 0;

  // 5) Una sola línea de cortesía (si ya estaba todo cerrado, no se repite).
  if (cambio) await responderTexto(ctx, TEXTO_CORTESIA_NO);
}

// -----------------------------------------------------------------------------
// «Sí»
// -----------------------------------------------------------------------------

/**
 * Lead del primer «Sí» (decisión 4): origen `whatsapp`, empresa, sin
 * asignar (bolsa común, decisión 6). Si ya hay un lead vivo con ese teléfono,
 * se enlaza ese en lugar de crear otro.
 */
async function crearLeadDelSi(ctx: ContextoRespuesta & { prospecto: ProspectoRespuesta }): Promise<string | null> {
  const db = admin();
  const p = ctx.prospecto;
  if (p.lead_id) return p.lead_id;
  const sello = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

  if (p.telefono_e164) {
    const { data: existente } = await db
      .from("leads")
      .select("id, notes")
      .eq("company_id", ctx.companyId)
      .eq("phone_primary", p.telefono_e164)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    const ex = existente as { id: string; notes: string | null } | null;
    if (ex) {
      await db
        .from("leads")
        .update({ notes: `${ex.notes ?? ""}\n\n[WhatsApp · ${sello}] Ha dicho «Sí» a la captación.`.trim().slice(0, 8000) })
        .eq("company_id", ctx.companyId)
        .eq("id", ex.id);
      return ex.id;
    }
  }

  let campana: string | null = null;
  if (p.campana_id) {
    const { data } = await db
      .from("captacion_campanas")
      .select("nombre")
      .eq("company_id", ctx.companyId)
      .eq("id", p.campana_id)
      .maybeSingle();
    campana = (data as { nombre: string } | null)?.nombre ?? null;
  }
  const direccion = [p.direccion, p.codigo_postal, p.municipio].filter(Boolean).join(", ");
  const notas = [
    `[WhatsApp · ${sello}] Ha dicho «Sí» al mensaje de captación${campana ? ` (campaña «${campana}»)` : ""}.`,
    direccion ? `Dirección: ${direccion}` : null,
    p.web ? `Web: ${p.web}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { data, error } = await db
    .from("leads")
    .insert({
      company_id: ctx.companyId,
      party_kind: "company",
      trade_name: p.nombre_negocio,
      phone_primary: p.telefono_e164,
      email: p.email,
      origin: "whatsapp",
      potential: "unknown",
      status: "new",
      notes: notas.slice(0, 8000),
      tags: ["whatsapp"],
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo crear el lead: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * «Sí, cuéntame». Punto de enganche de la fase 4: el PDF se manda desde
 * enganchePropuestaFase4(), al final.
 */
export async function alDecirSi(ctx: ContextoRespuesta): Promise<void> {
  const db = admin();
  const p = ctx.prospecto;
  if (!p) return; // Contacto sin prospecto: se queda en la bandeja para una persona.

  await cancelarEnviosPendientes(ctx.companyId, p.id, "Dijo «Sí»", ["recordatorio"]);

  // La actualización condicionada es el cerrojo: un segundo «Sí» (o el mismo
  // evento reintentado) no crea otro lead ni repite los botones.
  const { data: gano, error } = await db
    .from("captacion_prospectos")
    .update({ etapa: "interesado" })
    .eq("company_id", ctx.companyId)
    .eq("id", p.id)
    .in("etapa", ETAPAS_ANTES_DE_SI)
    .select("id");
  if (error) throw new Error(error.message);
  if (((gano ?? []) as unknown[]).length === 0) return;

  let leadId: string | null = null;
  try {
    leadId = await crearLeadDelSi({ ...ctx, prospecto: p });
    if (leadId) {
      await db.from("captacion_prospectos").update({ lead_id: leadId }).eq("company_id", ctx.companyId).eq("id", p.id);
    }
  } catch (e) {
    console.error("[captacion/respuestas] lead del «Sí»", e instanceof Error ? e.message : e);
  }

  // Fase 4: la propuesta (PDF + página). Con after() si hay petición en curso,
  // para que el webhook conteste a Meta sin esperar al PDF. Los botones salen
  // después del documento.
  const propuestaYBotones = async () => {
    await enganchePropuestaFase4({ ...ctx, prospecto: p, leadId });
    await botonesTrasSi(ctx, p);
  };
  try {
    after(propuestaYBotones);
  } catch {
    // Fuera de una petición (p. ej. un reproceso): en línea.
    await propuestaYBotones();
  }
}

async function botonesTrasSi(ctx: ContextoRespuesta, p: ProspectoRespuesta): Promise<void> {
  try {
    const con = await conexionDe(ctx.companyId);
    if (con) {
      const texto =
        "¡Gracias! Te hemos preparado la información para un negocio como el vuestro. ¿Quieres que alguien del equipo te llame para contártelo?";
      const wamid = await enviarBotones(
        con.token,
        con.phoneNumberId,
        { waId: ctx.mensaje.contacto.waId, bsuid: ctx.mensaje.contacto.bsuid },
        texto,
        [
          { id: cargaBoton("llamar", p.id), titulo: BOTON_LLAMAR },
          { id: cargaBoton("ahora_no", p.id), titulo: BOTON_AHORA_NO },
        ],
      );
      await guardarSaliente(ctx, wamid, "boton", `${texto}\n[${BOTON_LLAMAR}] [${BOTON_AHORA_NO}]`);
    }
  } catch (e) {
    console.error("[captacion/respuestas] botones del «Sí»", e instanceof Error ? e.message : e);
  }
}

/**
 * FASE 4 (plan §4.5): crea la propuesta con la foto de los equipos de la
 * campaña, genera el PDF, lo sube al bucket privado y lo manda como mensaje
 * `document` (medio subido a Meta; si la subida falla, por enlace) con el
 * enlace a /p/[codigo] en el pie. Avisa al responsable de que ha dicho «Sí».
 * Nunca lanza: lo que falla queda en captacion_propuestas.envio_error.
 */
export async function enganchePropuestaFase4(
  ctx: ContextoRespuesta & { prospecto: ProspectoRespuesta; leadId: string | null },
): Promise<void> {
  const p = ctx.prospecto;
  const db = admin();
  let resumen = "Se le ha mandado la propuesta.";
  let propuestaId: string | null = null;
  try {
    const empresa = await cargarEmpresaPropuesta(ctx.companyId);
    if (!empresa) throw new Error("No se encontró la empresa.");
    const prop = await crearPropuesta({ companyId: ctx.companyId, prospecto: p, conversacionId: ctx.conversacionId, empresa });
    propuestaId = prop.id;
    if (prop.enviada_at) return; // Reintento de algo ya enviado.

    const pdf = await generarPdfPropuesta(ctx.companyId, prop, empresa);
    await guardarPdf(prop, pdf.bytes, pdf.paginas);

    // Fase 8: la ventana se lee de la base (el trigger la abre con el «Sí»).
    // Si este aviso se reprocesa tarde y ya está cerrada, sale con la
    // plantilla de documento o queda pendiente.
    const destino = (await destinoDeConversacion(ctx.companyId, ctx.conversacionId)) ?? {
      conversacionId: ctx.conversacionId,
      waId: ctx.mensaje.contacto.waId,
      bsuid: ctx.mensaje.contacto.bsuid,
      ventanaHasta: null,
    };
    const r = await mandarPropuesta({
      companyId: ctx.companyId,
      prop,
      destino: {
        ...destino,
        waId: ctx.mensaje.contacto.waId ?? destino.waId,
        bsuid: ctx.mensaje.contacto.bsuid ?? destino.bsuid,
      },
      empresa,
      bytes: pdf.bytes,
    });
    if (r.via === "plantilla") resumen = "Se le ha mandado la propuesta con la plantilla de documento (ya habían pasado 24 h).";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[captacion/propuesta] no se pudo mandar", msg);
    resumen =
      e instanceof SinEquipos
        ? "No se le ha mandado propuesta: la campaña no tiene equipos asignados."
        : e instanceof PropuestaSinVentana
          ? "No se le ha mandado la propuesta: han pasado 24 h y no hay plantilla de documento aprobada. Escríbele cuando vuelva a escribir."
          : "No se le pudo mandar la propuesta; escríbele desde la bandeja.";
    if (propuestaId) {
      await db
        .from("captacion_propuestas")
        .update({ envio_error: msg.slice(0, 500) })
        .eq("company_id", ctx.companyId)
        .eq("id", propuestaId);
    }
  }
  await avisarResponsable(ctx.companyId, p.campana_id, {
    kind: "captacion.dijo_si",
    category: "alert",
    title: `${p.nombre_negocio} ha dicho «Sí»`,
    body: resumen,
    actionUrl: `/captacion/bandeja/${ctx.conversacionId}`,
    sujetoId: p.id,
  });
}

// -----------------------------------------------------------------------------
// [Que me llaméis] y texto libre
// -----------------------------------------------------------------------------

/** [Que me llaméis]: el lead pasa a prioritario (potencial A y etiqueta «llamar»). */
export async function alPedirLlamada(ctx: ContextoRespuesta): Promise<void> {
  const db = admin();
  const p = ctx.prospecto;
  if (!p) return;
  const { data: upd, error } = await db
    .from("captacion_prospectos")
    .update({ etapa: "caliente", interes: 3 })
    .eq("company_id", ctx.companyId)
    .eq("id", p.id)
    .in("etapa", ["interesado", "conversando"])
    .select("id");
  if (error) throw new Error(error.message);
  const primeraVez = ((upd ?? []) as unknown[]).length > 0;

  const leadId = p.lead_id ?? (await crearLeadDelSi({ ...ctx, prospecto: p }));
  if (leadId) {
    if (!p.lead_id) {
      await db.from("captacion_prospectos").update({ lead_id: leadId }).eq("company_id", ctx.companyId).eq("id", p.id);
    }
    const { data: l } = await db.from("leads").select("tags").eq("company_id", ctx.companyId).eq("id", leadId).maybeSingle();
    const tags = new Set(((l as { tags: string[] | null } | null)?.tags ?? []) as string[]);
    tags.add("whatsapp");
    tags.add("llamar");
    const { error: eL } = await db
      .from("leads")
      .update({ potential: "A", tags: [...tags] })
      .eq("company_id", ctx.companyId)
      .eq("id", leadId);
    if (eL) throw new Error(`No se pudo marcar el lead: ${eL.message}`);
  }
  if (primeraVez) await responderTexto(ctx, TEXTO_CORTESIA_LLAMADA);
}

/**
 * Texto libre con la referencia de una propuesta («ref. K7M2Q4»): es el
 * mensaje prellenado del botón «Que me llaméis» de /p/[codigo] (o el de
 * «Pedir una actualizada»), y puede llegar desde otro teléfono (el encargado
 * reenvía el enlace al dueño). Se trata igual que el botón [Que me llaméis]
 * sobre el prospecto de esa propuesta. Devuelve true si lo ha tratado.
 */
async function alTraerReferencia(ctx: ContextoRespuesta): Promise<boolean> {
  const ref = referenciaEnTexto(ctx.mensaje.cuerpo);
  if (!ref) return false;
  const prop = await propuestaPorReferencia(ctx.companyId, ref);
  if (!prop?.prospecto_id) return false;
  const prospecto =
    ctx.prospecto?.id === prop.prospecto_id ? ctx.prospecto : await leerProspecto(ctx.companyId, prop.prospecto_id);
  if (!prospecto) return false;
  await cancelarEnviosPendientes(ctx.companyId, prospecto.id, "Ha contestado", ["recordatorio"]);
  await alPedirLlamada({ ...ctx, prospecto });
  return true;
}

/** Texto libre (u otro tipo): se queda en la bandeja; ya no toca recordatorio. */
async function alEscribirLibre(ctx: ContextoRespuesta): Promise<void> {
  if (ctx.mensaje.tipo === "texto" && (await alTraerReferencia(ctx))) return;
  const p = ctx.prospecto;
  if (!p) return;
  await cancelarEnviosPendientes(ctx.companyId, p.id, "Ha contestado", ["recordatorio"]);
  await admin()
    .from("captacion_prospectos")
    .update({ etapa: "conversando" })
    .eq("company_id", ctx.companyId)
    .eq("id", p.id)
    .in("etapa", ["en_cola", "contactado", "recordado", "sin_respuesta"]);
  // Primer contacto aún en cola y ya nos ha escrito: no se le manda el frío.
  await cancelarEnviosPendientes(ctx.companyId, p.id, "Nos ha escrito antes", ["primer_contacto"]);
  // Fase 5: el asistente (si la empresa lo tiene encendido y hay clave). Va
  // detrás de la baja por texto y del «No», que ya se han resuelto arriba.
  // ctx.prospecto.etapa conserva la etapa de antes de «conversando».
  await asistenteTrasTexto(ctx, { alDecirSi, alDecirNo, alPedirLlamada });
}
