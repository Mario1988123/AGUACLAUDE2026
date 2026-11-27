import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { admin, obtenerToken } from "./servidor";
import { enviarTexto } from "./meta";
import { ventanaAbierta } from "./bandeja-logica";
import { contactoBloqueado } from "./envios-servidor";
import { lineasDeCampana } from "./propuesta-servidor";
import type { TipoPrecio } from "./propuesta-logica";
import { avisarResponsable } from "./avisos";
import { captacionActiva } from "./guard";
import type { ContextoRespuesta } from "./respuestas";
import {
  conIdentificacion,
  construirEntrada,
  construirSistema,
  decidirSalida,
  ejecutarTurno,
  ESPERA_RAFAGA_MS,
  ETAPAS_PRIMERA_RESPUESTA,
  leerClasificacion,
  MAX_HISTORIAL,
  modeloValido,
  parametrosClasificacion,
  pideLlamada,
  pidePersona,
  preciosPermitidos,
  puedePromover,
  puertaDos,
  puertaUno,
  TEXTO_LLAMADA,
  TEXTO_PASO_A_PERSONA,
  TEXTO_SOLO_TEXTO,
  type ClaseRespuestaIA,
  type ClienteModelo,
  type ContextoEmpresa,
  type LlamadaHerramienta,
  type MensajeHistorial,
  type Modo,
  type Tokens,
} from "./asistente-logica";

/**
 * Asistente de captación (fase 5, plan §4.6) en el servidor: carga el
 * conocimiento de la empresa, aplica las puertas, llama a la API de Claude
 * y envía por WhatsApp. Lo llama respuestas.ts con el texto libre de un
 * prospecto, DESPUÉS de la baja por texto y del «No» (que van por delante).
 *
 * Sin ANTHROPIC_API_KEY en el entorno todo queda apagado: no se clasifica,
 * no se contesta y el interruptor del panel no se puede encender.
 */

// -----------------------------------------------------------------------------
// Clave y cliente
// -----------------------------------------------------------------------------

export function claveAnthropic(): string | null {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k ? k : null;
}

export function hayClaveAnthropic(): boolean {
  return claveAnthropic() !== null;
}

export function clienteModelo(): ClienteModelo | null {
  const apiKey = claveAnthropic();
  if (!apiKey) return null;
  const c = new Anthropic({ apiKey, maxRetries: 2, timeout: 45_000 });
  return { crear: (p) => c.beta.messages.create(p) };
}

// -----------------------------------------------------------------------------
// Conocimiento de la empresa
// -----------------------------------------------------------------------------

interface ConexionIA {
  estado: string;
  phone_number_id: string | null;
  ia_activa: boolean;
  modelo_ia: string | null;
  presentacion_empresa: string | null;
  temas_prohibidos: string | null;
  propuesta_precios: string[] | null;
}

async function leerConexion(companyId: string): Promise<ConexionIA | null> {
  const { data, error } = await admin()
    .from("captacion_conexiones")
    .select("estado, phone_number_id, ia_activa, modelo_ia, presentacion_empresa, temas_prohibidos, propuesta_precios")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conexión: ${error.message}`);
  return (data as ConexionIA | null) ?? null;
}

/**
 * Todo lo que el asistente puede decir: presentación, temas prohibidos, FAQ
 * (de la empresa y de la campaña), documentos y los equipos de la campaña
 * con sus precios de la lista blanca (§3.4), solo si la empresa enseña
 * precios. Sin campaña (chat de prueba), sin equipos.
 */
export async function cargarConocimiento(
  companyId: string,
  campanaId: string | null,
): Promise<{ ctx: ContextoEmpresa; modelo: string; iaActiva: boolean; conexion: ConexionIA | null }> {
  const db = admin();
  const conexion = await leerConexion(companyId);
  const tipos = ((conexion?.propuesta_precios ?? []) as string[]).filter(
    (t): t is TipoPrecio => t === "cash" || t === "renting" || t === "rental",
  );
  let qFaq = db
    .from("captacion_faq")
    .select("pregunta, respuesta, campana_id, orden")
    .eq("company_id", companyId)
    .eq("activa", true)
    .order("orden")
    .order("created_at")
    .limit(200);
  qFaq = campanaId ? qFaq.or(`campana_id.is.null,campana_id.eq.${campanaId}`) : qFaq.is("campana_id", null);

  const [empresa, faq, docs, equipos] = await Promise.all([
    db.from("companies").select("name").eq("id", companyId).maybeSingle(),
    qFaq,
    db
      .from("captacion_documentos")
      .select("titulo, contenido")
      .eq("company_id", companyId)
      .eq("activo", true)
      .order("orden")
      .order("created_at")
      .limit(50),
    campanaId ? lineasDeCampana(companyId, campanaId, tipos) : Promise.resolve([]),
  ]);
  if (faq.error) throw new Error(`No se pudo leer la FAQ: ${faq.error.message}`);
  if (docs.error) throw new Error(`No se pudieron leer los documentos: ${docs.error.message}`);

  return {
    conexion,
    iaActiva: conexion?.ia_activa === true,
    modelo: modeloValido(conexion?.modelo_ia),
    ctx: {
      nombreEmpresa: (empresa.data as { name: string } | null)?.name ?? "la empresa",
      presentacion: conexion?.presentacion_empresa ?? null,
      temasProhibidos: conexion?.temas_prohibidos ?? null,
      faq: (faq.data ?? []) as Array<{ pregunta: string; respuesta: string }>,
      documentos: (docs.data ?? []) as Array<{ titulo: string; contenido: string }>,
      equipos,
      conPrecios: tipos.length > 0,
    },
  };
}

// -----------------------------------------------------------------------------
// Entrada desde respuestas.ts
// -----------------------------------------------------------------------------

/** Lo que el asistente reutiliza de respuestas.ts (se pasa para no crear un ciclo de imports). */
export interface AccionesRespuesta {
  alDecirSi(ctx: ContextoRespuesta): Promise<void>;
  alDecirNo(ctx: ContextoRespuesta, motivo: "boton_no" | "baja_texto"): Promise<void>;
  alPedirLlamada(ctx: ContextoRespuesta): Promise<void>;
}

/**
 * Texto libre (u otro tipo) de un prospecto. Sigue después de contestar 200
 * a Meta, con after(); fuera de una petición (reproceso del cron), en línea.
 * Nunca lanza.
 */
export async function asistenteTrasTexto(ctx: ContextoRespuesta, acciones: AccionesRespuesta): Promise<void> {
  if (!hayClaveAnthropic() || !ctx.prospecto || ctx.mensaje.direccion !== "entrante") return;
  const trabajo = async () => {
    try {
      await turno(ctx, acciones);
    } catch (e) {
      console.error("[captacion/asistente] turno", e instanceof Error ? e.message : e);
    }
  };
  try {
    after(trabajo);
  } catch {
    await trabajo();
  }
}

interface EstadoConversacion {
  id: string;
  modo: Modo;
  ventana_hasta: string | null;
  ia_mensajes: number;
  ia_identificada_at: string | null;
  ia_silenciada_at: string | null;
  atendida_por: string | null;
  prospecto_id: string | null;
  telefono_e164: string | null;
  bsuid: string | null;
}

async function leerEstado(companyId: string, id: string): Promise<EstadoConversacion | null> {
  const { data, error } = await admin()
    .from("captacion_conversaciones")
    .select("id, modo, ventana_hasta, ia_mensajes, ia_identificada_at, ia_silenciada_at, atendida_por, prospecto_id, telefono_e164, bsuid")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  return (data as EstadoConversacion | null) ?? null;
}

async function ultimoEntrante(companyId: string, conversacionId: string): Promise<string | null> {
  const { data } = await admin()
    .from("captacion_mensajes")
    .select("id")
    .eq("company_id", companyId)
    .eq("conversacion_id", conversacionId)
    .eq("direccion", "entrante")
    .order("created_at", { ascending: false })
    .order("meta_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function historial(companyId: string, conversacionId: string): Promise<MensajeHistorial[]> {
  const { data, error } = await admin()
    .from("captacion_mensajes")
    .select("direccion, autor, tipo, cuerpo, created_at")
    .eq("company_id", companyId)
    .eq("conversacion_id", conversacionId)
    .order("created_at", { ascending: false })
    .order("meta_at", { ascending: false })
    .limit(MAX_HISTORIAL);
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
  return ((data ?? []) as MensajeHistorial[]).reverse();
}

/** Clasifica la primera respuesta a la plantilla (§4.4.3) con el modelo pequeño. */
async function clasificar(cliente: ClienteModelo, companyId: string, conversacionId: string, texto: string): Promise<ClaseRespuestaIA | null> {
  const { data } = await admin()
    .from("captacion_mensajes")
    .select("cuerpo")
    .eq("company_id", companyId)
    .eq("conversacion_id", conversacionId)
    .eq("tipo", "plantilla")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  try {
    const r = await cliente.crear(parametrosClasificacion((data as { cuerpo: string | null } | null)?.cuerpo ?? null, texto));
    return leerClasificacion(r);
  } catch (e) {
    console.error("[captacion/asistente] clasificación", e instanceof Error ? e.message : e);
    return null;
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function turno(ctx: ContextoRespuesta, acciones: AccionesRespuesta): Promise<void> {
  const db = admin();
  const { companyId, conversacionId, mensaje: m } = ctx;
  const p = ctx.prospecto;
  if (!p) return;
  const cliente = clienteModelo();
  if (!cliente) return;
  if (!(await captacionActiva(companyId))) return;
  const conexion = await leerConexion(companyId);
  if (conexion?.estado !== "activa" || conexion.ia_activa !== true) return;

  // Un turno por mensaje: el reintento de Meta o del cron no contesta dos veces.
  const { data: reclamado, error: eRec } = await db
    .from("captacion_mensajes")
    .update({ procesado_ia_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("wamid", m.wamid)
    .is("procesado_ia_at", null)
    .select("id");
  if (eRec) throw new Error(eRec.message);
  const mensajeId = ((reclamado ?? []) as Array<{ id: string }>)[0]?.id;
  if (!mensajeId) return;

  // Si una persona ya lleva la conversación, la IA no hace nada (ni clasificar).
  const inicial = await leerEstado(companyId, conversacionId);
  if (!inicial) return;
  const promovible = puedePromover({
    modo: inicial.modo,
    iaSilenciadaAt: inicial.ia_silenciada_at,
    atendidaPor: inicial.atendida_por,
    prospectoId: inicial.prospecto_id,
    campanaId: p.campana_id,
  });
  if (inicial.modo !== "ia" && !promovible) return;

  // Primera respuesta a la plantilla sin botón: sí · no · duda · otro.
  if (m.tipo === "texto" && m.cuerpo && ETAPAS_PRIMERA_RESPUESTA.includes(p.etapa)) {
    const clase = await clasificar(cliente, companyId, conversacionId, m.cuerpo);
    if (clase === "si") return acciones.alDecirSi(ctx);
    if (clase === "no") return acciones.alDecirNo(ctx, "baja_texto");
  }

  // Ráfaga: si llega otro mensaje en estos segundos, contesta su turno.
  await dormir(ESPERA_RAFAGA_MS);
  if ((await ultimoEntrante(companyId, conversacionId)) !== mensajeId) return;

  let conv = await leerEstado(companyId, conversacionId);
  if (!conv) return;
  if (puedePromover({ modo: conv.modo, iaSilenciadaAt: conv.ia_silenciada_at, atendidaPor: conv.atendida_por, prospectoId: conv.prospecto_id, campanaId: p.campana_id })) {
    const { data: prom } = await db
      .from("captacion_conversaciones")
      .update({ modo: "ia" })
      .eq("company_id", companyId)
      .eq("id", conversacionId)
      .eq("modo", "humano")
      .is("ia_silenciada_at", null)
      .is("atendida_por", null)
      .select("id");
    if (((prom ?? []) as unknown[]).length > 0) conv = { ...conv, modo: "ia" };
  }

  // Puerta 1.
  const puerta = puertaUno({
    hayClave: true,
    iaActiva: true,
    modo: conv.modo,
    ventanaAbierta: ventanaAbierta(conv.ventana_hasta),
    bloqueado: await contactoBloqueado(companyId, conv.telefono_e164, conv.bsuid),
    iaMensajes: conv.ia_mensajes,
  });
  if (!puerta.pasa) {
    if (puerta.motivo === "tope") await pasarAPersona(ctx, conv, "tope", "El asistente ha llegado al tope de mensajes.");
    return;
  }

  // Audio, imagen, documento…: la IA solo lee texto.
  if (m.tipo !== "texto") {
    if (m.tipo === "reaccion" || m.tipo === "sticker") return;
    await enviarIA(ctx, conv, TEXTO_SOLO_TEXTO, null, null);
    return;
  }

  const mensajes = await historial(companyId, conversacionId);
  const ultimoSaliente = mensajes.map((x) => x.direccion).lastIndexOf("saliente");
  const rafaga = mensajes
    .slice(ultimoSaliente + 1)
    .filter((x) => x.direccion === "entrante")
    .map((x) => x.cuerpo ?? "")
    .join("\n");

  // Antes del modelo: petición de persona o de llamada por expresión.
  if (pidePersona(rafaga)) return pasarAPersona(ctx, conv, "pide_persona", "Ha pedido hablar con una persona.");
  if (pideLlamada(rafaga)) return pedirLlamada(ctx, conv, acciones, null);

  const { ctx: conocimiento, modelo } = await cargarConocimiento(companyId, p.campana_id);
  const { data: pros } = await db
    .from("captacion_prospectos")
    .select("tipologia_clave")
    .eq("company_id", companyId)
    .eq("id", p.id)
    .maybeSingle();
  const r = await ejecutarTurno({
    cliente,
    modelo,
    sistema: construirSistema(conocimiento),
    entrada: construirEntrada({ negocio: p.nombre_negocio, tipologia: (pros as { tipologia_clave: string | null } | null)?.tipologia_clave ?? null }, mensajes),
  });
  const salida = decidirSalida(r, preciosPermitidos(conocimiento.equipos, conocimiento.conPrecios));

  // Puerta 2: justo antes de enviar.
  const ahora = await leerEstado(companyId, conversacionId);
  const puerta2 = ahora
    ? puertaDos({
        modoAhora: ahora.modo,
        ultimoEntranteAhora: await ultimoEntrante(companyId, conversacionId),
        ultimoEntranteTurno: mensajeId,
        iaMensajesAhora: ahora.ia_mensajes,
        iaMensajesTurno: conv.ia_mensajes,
      })
    : ({ pasa: false, motivo: "silenciada" } as const);
  if (!puerta2.pasa || !ahora) {
    console.info("[captacion/asistente] respuesta descartada:", puerta2.pasa ? "sin conversación" : puerta2.motivo);
    return;
  }

  for (const h of r.herramientas) if (h.nombre === "marcar_interes") await marcarInteres(ctx, h);

  if (salida.accion === "responder") await enviarIA(ctx, ahora, salida.texto, r.tokens, modelo);
  else if (salida.accion === "persona") await pasarAPersona(ctx, ahora, salida.motivo, salida.detalle, r.tokens, modelo);
  else if (salida.accion === "llamada") await pedirLlamada(ctx, ahora, acciones, salida.detalle);
}

// -----------------------------------------------------------------------------
// Efectos
// -----------------------------------------------------------------------------

/**
 * Envía un mensaje del asistente: identificación delante si es el primero,
 * guardado con autor «ia» y tokens, contador +1. Nunca lanza.
 */
async function enviarIA(
  ctx: ContextoRespuesta,
  conv: EstadoConversacion,
  texto: string,
  tokens: Tokens | null,
  modelo: string | null,
): Promise<boolean> {
  const db = admin();
  try {
    const conexion = await leerConexion(ctx.companyId);
    if (conexion?.estado !== "activa" || !conexion.phone_number_id) return false;
    const token = await obtenerToken(ctx.companyId);
    if (!token) return false;
    const { data: co } = await db.from("companies").select("name").eq("id", ctx.companyId).maybeSingle();
    const cuerpo = conIdentificacion(texto, (co as { name: string } | null)?.name ?? "la empresa", !!conv.ia_identificada_at);
    const wamid = await enviarTexto(token, conexion.phone_number_id, { waId: ctx.mensaje.contacto.waId, bsuid: ctx.mensaje.contacto.bsuid }, cuerpo);
    const ahora = new Date().toISOString();
    const { error } = await db.from("captacion_mensajes").insert({
      company_id: ctx.companyId,
      conversacion_id: ctx.conversacionId,
      direccion: "saliente",
      autor: "ia",
      origen: "api",
      tipo: "texto",
      cuerpo,
      wamid,
      estado: "enviado",
      meta_at: ahora,
      modelo_ia: modelo,
      tokens_entrada: tokens?.entrada ?? null,
      tokens_salida: tokens?.salida ?? null,
      tokens_cache_lectura: tokens?.cacheLectura ?? null,
      tokens_cache_escritura: tokens?.cacheEscritura ?? null,
    });
    if (error) console.error("[captacion/asistente] enviado pero no guardado", error.message);
    const { error: eC } = await db
      .from("captacion_conversaciones")
      .update({ ia_mensajes: conv.ia_mensajes + 1, ...(conv.ia_identificada_at ? {} : { ia_identificada_at: ahora }) })
      .eq("company_id", ctx.companyId)
      .eq("id", ctx.conversacionId)
      .eq("ia_mensajes", conv.ia_mensajes);
    if (eC) console.error("[captacion/asistente] contador", eC.message);
    return true;
  } catch (e) {
    console.error("[captacion/asistente] no se pudo enviar", e instanceof Error ? e.message : e);
    return false;
  }
}

type MotivoSilencio = "pide_persona" | "pide_llamada" | "herramienta" | "tope" | "precio" | "rechazo" | "error";

/** Calla a la IA (solo si seguía en `ia`). Devuelve true si la ha callado este turno. */
async function silenciar(ctx: ContextoRespuesta, motivo: MotivoSilencio): Promise<boolean> {
  const { data, error } = await admin()
    .from("captacion_conversaciones")
    .update({ modo: "humano", ia_silenciada_at: new Date().toISOString(), ia_silenciada_motivo: motivo, ia_silenciada_por: null })
    .eq("company_id", ctx.companyId)
    .eq("id", ctx.conversacionId)
    .eq("modo", "ia")
    .select("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).length > 0;
}

const TITULO_SILENCIO: Record<MotivoSilencio, string> = {
  pide_persona: "quiere hablar con una persona",
  pide_llamada: "pide que le llaméis",
  herramienta: "necesita a una persona",
  tope: "necesita a una persona (tope del asistente)",
  precio: "necesita a una persona (pregunta de precio)",
  rechazo: "necesita a una persona",
  error: "necesita a una persona (el asistente falló)",
};

async function avisarPaso(ctx: ContextoRespuesta, motivo: MotivoSilencio, detalle: string | null): Promise<void> {
  const p = ctx.prospecto;
  await avisarResponsable(ctx.companyId, p?.campana_id ?? null, {
    kind: "captacion.pide_persona",
    category: "alert",
    severity: "warning",
    title: `${p?.nombre_negocio ?? "Un contacto"} ${TITULO_SILENCIO[motivo]}`,
    body: detalle ? detalle.slice(0, 300) : "El asistente ya no contesta en esta conversación.",
    actionUrl: `/captacion/bandeja/${ctx.conversacionId}`,
    sujetoId: p?.id ?? null,
  });
}

async function pasarAPersona(
  ctx: ContextoRespuesta,
  conv: EstadoConversacion,
  motivo: MotivoSilencio,
  detalle: string | null,
  tokens: Tokens | null = null,
  modelo: string | null = null,
): Promise<void> {
  if (!(await silenciar(ctx, motivo))) return;
  await enviarIA(ctx, conv, TEXTO_PASO_A_PERSONA, tokens, modelo);
  await avisarPaso(ctx, motivo, detalle);
}

/** Reutiliza [Que me llaméis] de respuestas.ts: lead prioritario y cortesía. */
async function pedirLlamada(
  ctx: ContextoRespuesta,
  conv: EstadoConversacion,
  acciones: AccionesRespuesta,
  nota: string | null,
): Promise<void> {
  const p = ctx.prospecto;
  if (!p || !(await silenciar(ctx, "pide_llamada"))) return;
  const { data } = await admin()
    .from("captacion_prospectos")
    .select("etapa")
    .eq("company_id", ctx.companyId)
    .eq("id", p.id)
    .maybeSingle();
  const etapa = (data as { etapa: string } | null)?.etapa ?? p.etapa;
  // alPedirLlamada solo manda su cortesía la primera vez (interesado/conversando → caliente).
  const mandaCortesia = etapa === "interesado" || etapa === "conversando";
  await acciones.alPedirLlamada({ ...ctx, prospecto: { ...p, etapa } });
  if (!mandaCortesia) await enviarIA(ctx, conv, TEXTO_LLAMADA, null, null);
  await avisarPaso(ctx, "pide_llamada", nota ? `Nota: ${nota}` : null);
}

/** marcar_interes: guarda nivel y resumen; con 2 o más, `caliente` y aviso (uno cada 24 h). */
async function marcarInteres(ctx: ContextoRespuesta, h: Extract<LlamadaHerramienta, { nombre: "marcar_interes" }>): Promise<void> {
  const p = ctx.prospecto;
  if (!p) return;
  const db = admin();
  try {
    const { data } = await db
      .from("captacion_prospectos")
      .select("interes")
      .eq("company_id", ctx.companyId)
      .eq("id", p.id)
      .maybeSingle();
    const previo = (data as { interes: number | null } | null)?.interes ?? 0;
    await db
      .from("captacion_prospectos")
      .update({ interes: Math.max(previo, h.nivel), interes_resumen: h.resumen || null })
      .eq("company_id", ctx.companyId)
      .eq("id", p.id);
    if (h.nivel < 2) return;
    await db
      .from("captacion_prospectos")
      .update({ etapa: "caliente" })
      .eq("company_id", ctx.companyId)
      .eq("id", p.id)
      .in("etapa", ["interesado", "conversando"]);
    const hace24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: gano } = await db
      .from("captacion_prospectos")
      .update({ aviso_interes_at: new Date().toISOString() })
      .eq("company_id", ctx.companyId)
      .eq("id", p.id)
      .or(`aviso_interes_at.is.null,aviso_interes_at.lt.${hace24h}`)
      .select("id");
    if (((gano ?? []) as unknown[]).length === 0) return;
    await avisarResponsable(ctx.companyId, p.campana_id, {
      kind: "captacion.interes",
      category: "alert",
      severity: "warning",
      title: `${p.nombre_negocio} muestra interés`,
      body: h.resumen || null,
      actionUrl: `/captacion/bandeja/${ctx.conversacionId}`,
      sujetoId: p.id,
    });
  } catch (e) {
    console.error("[captacion/asistente] interés", e instanceof Error ? e.message : e);
  }
}

// -----------------------------------------------------------------------------
// Chat de prueba (no manda nada por WhatsApp)
// -----------------------------------------------------------------------------

export interface ResultadoPrueba {
  accion: "responder" | "persona" | "llamada" | "nada";
  /** Lo que recibiría el contacto. */
  texto: string | null;
  /** Por qué pasa a persona o qué nota deja la llamada. */
  detalle: string | null;
  herramientas: LlamadaHerramienta[];
  tokens: Tokens | null;
  modelo: string;
}

export async function probarAsistente(args: {
  companyId: string;
  campanaId: string | null;
  mensajes: Array<{ rol: "contacto" | "asistente"; texto: string }>;
}): Promise<ResultadoPrueba> {
  const cliente = clienteModelo();
  if (!cliente) throw new Error("Falta la clave de Anthropic (ANTHROPIC_API_KEY) en el servidor.");
  const { ctx, modelo } = await cargarConocimiento(args.companyId, args.campanaId);
  const yaIdentificada = args.mensajes.some((x) => x.rol === "asistente");
  const ultimo = [...args.mensajes].reverse().find((x) => x.rol === "contacto")?.texto ?? "";
  const vacio = { herramientas: [], tokens: null, modelo };

  if (pidePersona(ultimo)) {
    return { ...vacio, accion: "persona", texto: conIdentificacion(TEXTO_PASO_A_PERSONA, ctx.nombreEmpresa, yaIdentificada), detalle: "Ha pedido una persona (detectado sin IA)." };
  }
  if (pideLlamada(ultimo)) {
    return { ...vacio, accion: "llamada", texto: TEXTO_LLAMADA, detalle: "Ha pedido que le llamen (detectado sin IA)." };
  }

  const historialPrueba: MensajeHistorial[] = args.mensajes.map((x) => ({
    direccion: x.rol === "contacto" ? "entrante" : "saliente",
    autor: x.rol === "contacto" ? "contacto" : "ia",
    tipo: "texto",
    cuerpo: x.texto,
  }));
  const r = await ejecutarTurno({
    cliente,
    modelo,
    sistema: construirSistema(ctx),
    entrada: construirEntrada({ negocio: "Negocio de prueba", tipologia: null }, historialPrueba),
  });
  const s = decidirSalida(r, preciosPermitidos(ctx.equipos, ctx.conPrecios));
  const base = { herramientas: r.herramientas, tokens: r.tokens, modelo };
  if (s.accion === "responder") return { ...base, accion: "responder", texto: conIdentificacion(s.texto, ctx.nombreEmpresa, yaIdentificada), detalle: null };
  if (s.accion === "persona") {
    const motivos: Record<string, string> = {
      herramienta: "El asistente ha decidido pasar a una persona",
      precio: "Se ha descartado la respuesta por un precio que no está en el catálogo",
      rechazo: "El modelo no ha querido contestar",
      error: "Error al generar la respuesta",
    };
    return {
      ...base,
      accion: "persona",
      texto: conIdentificacion(TEXTO_PASO_A_PERSONA, ctx.nombreEmpresa, yaIdentificada),
      detalle: [motivos[s.motivo], s.detalle].filter(Boolean).join(": "),
    };
  }
  if (s.accion === "llamada") return { ...base, accion: "llamada", texto: TEXTO_LLAMADA, detalle: s.detalle };
  return { ...base, accion: "nada", texto: null, detalle: "El asistente no ha contestado nada." };
}
