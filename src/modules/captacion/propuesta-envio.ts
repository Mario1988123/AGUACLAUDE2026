import "server-only";
import { siteBaseUrl } from "@/shared/lib/site-url";
import { admin, obtenerToken } from "./servidor";
import { enviarDocumento, enviarPlantillaConComponentes, ErrorMeta, subirMedio } from "./meta";
import {
  analizarPlantilla,
  componentesEnvioDocumento,
  parametroNombre,
  plantillaSirveParaDocumento,
  renderizarCuerpo,
} from "./envios-logica";
import { evaluarGasto, inicioMesMadrid, viaEnvioPropuesta } from "./mando-logica";
import { nombreFicheroPdf, pieDocumento } from "./propuesta-logica";
import { cargarEmpresaPropuesta, guardarPdf, leerPdf, type EmpresaPropuesta, type FilaPropuesta } from "./propuesta-servidor";
import { generarPdfPropuesta } from "./pdf-propuesta";
import { contactoBloqueado } from "./envios-servidor";

/**
 * Envío del PDF de la propuesta por WhatsApp (fase 4, ampliado en la fase 8).
 * Lo usan el «Sí» (respuestas.ts) y el reintento del cron (mando-servidor.ts).
 *
 *  · Ventana de 24 h abierta → mensaje `document` normal (servicio).
 *  · Cerrada y hay plantilla aprobada de uso «documento» → esa plantilla, con
 *    el PDF en la cabecera. Se apunta en captacion_envios (tipo «documento»):
 *    así cuenta en el gasto del mes y el índice único (prospecto_id, tipo)
 *    impide mandarla dos veces al mismo prospecto. No se reintenta sola si
 *    falla (§5.3: mejor perder un envío que mandar dos).
 *  · Cerrada y sin plantilla → PropuestaSinVentana: queda pendiente, como
 *    antes de la fase 8.
 *
 * Va aparte de propuesta-servidor.ts porque necesita el generador del PDF, y
 * pdf-propuesta.ts ya importa propuesta-servidor.ts.
 */

export class PropuestaSinVentana extends Error {
  constructor() {
    super("Han pasado 24 h desde su último mensaje y no hay plantilla de documento aprobada: la propuesta queda pendiente.");
    this.name = "PropuestaSinVentana";
  }
}

export interface DestinoPropuesta {
  conversacionId: string;
  waId: string | null;
  bsuid: string | null;
  /** captacion_conversaciones.ventana_hasta */
  ventanaHasta: string | null;
}

export interface PlantillaDocumento {
  id: string;
  nombre: string;
  idioma: string;
  cuerpo: string | null;
  variablesCuerpo: number;
}

/** La plantilla aprobada de uso «documento» de la empresa, si la hay y sirve. */
export async function plantillaDocumentoAprobada(companyId: string): Promise<PlantillaDocumento | null> {
  const { data, error } = await admin()
    .from("captacion_plantillas")
    .select("id, nombre, idioma, componentes")
    .eq("company_id", companyId)
    .eq("uso", "documento")
    .eq("estado", "aprobada")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[captacion/propuesta] plantilla de documento:", error.message);
    return null;
  }
  const p = data as { id: string; nombre: string; idioma: string; componentes: unknown } | null;
  if (!p) return null;
  const a = analizarPlantilla(p.componentes);
  if (!plantillaSirveParaDocumento(a).ok) return null;
  return { id: p.id, nombre: p.nombre, idioma: p.idioma, cuerpo: a.cuerpo, variablesCuerpo: a.variablesCuerpo };
}

/** Ventana de la conversación tal como está en la base (la mantiene el trigger). */
export async function destinoDeConversacion(companyId: string, conversacionId: string): Promise<DestinoPropuesta | null> {
  const { data, error } = await admin()
    .from("captacion_conversaciones")
    .select("id, wa_id, bsuid, ventana_hasta")
    .eq("company_id", companyId)
    .eq("id", conversacionId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  const c = data as { id: string; wa_id: string | null; bsuid: string | null; ventana_hasta: string | null } | null;
  return c ? { conversacionId: c.id, waId: c.wa_id, bsuid: c.bsuid, ventanaHasta: c.ventana_hasta } : null;
}

async function conexion(companyId: string): Promise<{ token: string; phoneNumberId: string; topeCents: number }> {
  const { data } = await admin()
    .from("captacion_conexiones")
    .select("estado, phone_number_id, tope_gasto_mensual_cents")
    .eq("company_id", companyId)
    .maybeSingle();
  const c = data as { estado: string; phone_number_id: string | null; tope_gasto_mensual_cents: number } | null;
  if (c?.estado !== "activa" || !c.phone_number_id) throw new Error("La conexión de WhatsApp no está activa.");
  const token = await obtenerToken(companyId);
  if (!token) throw new Error("Sin token de Meta.");
  return { token, phoneNumberId: c.phone_number_id, topeCents: c.tope_gasto_mensual_cents };
}

/**
 * Manda la propuesta por la vía que toque. Lanza si no sale (el que llama lo
 * deja en envio_error); PropuestaSinVentana si no hay forma de mandarla.
 */
export async function mandarPropuesta(args: {
  companyId: string;
  prop: FilaPropuesta;
  destino: DestinoPropuesta;
  empresa?: EmpresaPropuesta | null;
  /** PDF ya generado; si no, se lee del bucket o se vuelve a generar. */
  bytes?: Uint8Array;
  ahora?: Date;
}): Promise<{ via: "servicio" | "plantilla"; wamid: string }> {
  const { companyId, prop, destino } = args;
  const ahora = args.ahora ?? new Date();
  const db = admin();
  const con = await conexion(companyId);

  const abierta = viaEnvioPropuesta(destino.ventanaHasta, false, ahora) === "servicio";
  const plantilla = abierta ? null : await plantillaDocumentoAprobada(companyId);
  const via = viaEnvioPropuesta(destino.ventanaHasta, Boolean(plantilla), ahora);
  if (!via) throw new PropuestaSinVentana();

  if (via === "plantilla") {
    // Fuera de la ventana, con lo que cuesta: las mismas cautelas que el frío.
    if (!prop.prospecto_id) throw new Error("La propuesta no tiene prospecto: no se manda con plantilla.");
    if (await contactoBloqueado(companyId, destino.waId ? `+${destino.waId}` : null, destino.bsuid)) {
      throw new Error("El contacto está bloqueado: no se le manda nada.");
    }
    const { data: g, error: eG } = await db.rpc("captacion_gasto_mes", {
      p_company_id: companyId,
      p_desde: inicioMesMadrid(ahora).toISOString(),
    });
    if (eG) throw new Error(`Gasto: ${eG.message}`);
    const f = (Array.isArray(g) ? g[0] : g) as { confirmado_milicentimos: number | string; en_vuelo: number } | undefined;
    const gasto = evaluarGasto({
      confirmadoMilicentimos: Number(f?.confirmado_milicentimos ?? 0),
      enVuelo: Number(f?.en_vuelo ?? 0),
      topeCents: con.topeCents,
    });
    if (gasto.nivel === "tope") throw new Error("Tope de gasto del mes alcanzado: la propuesta con plantilla no sale.");
  }

  // El PDF.
  let bytes = args.bytes ?? (await leerPdf(prop));
  if (!bytes) {
    const empresa = args.empresa ?? (await cargarEmpresaPropuesta(companyId));
    if (!empresa) throw new Error("No se encontró la empresa.");
    const pdf = await generarPdfPropuesta(companyId, prop, empresa);
    await guardarPdf(prop, pdf.bytes, pdf.paginas);
    bytes = pdf.bytes;
  }

  const urlPagina = `${siteBaseUrl()}/p/${prop.codigo}`;
  const nombreFichero = nombreFicheroPdf(prop.nombre_negocio);
  const pie = pieDocumento(urlPagina);
  let mediaId: string | null = null;
  try {
    mediaId = await subirMedio(con.token, con.phoneNumberId, { bytes, nombre: nombreFichero, tipo: "application/pdf" });
  } catch (e) {
    console.error("[captacion/propuesta] subir a Meta; se manda por enlace", e instanceof Error ? e.message : e);
  }
  const doc = { ...(mediaId ? { mediaId } : { link: `${urlPagina}/pdf` }), nombreFichero };
  const para = { waId: destino.waId, bsuid: destino.bsuid };

  let wamid: string;
  let cuerpoBandeja = pie;
  if (via === "servicio") {
    wamid = await enviarDocumento(con.token, con.phoneNumberId, para, { ...doc, pie });
  } else {
    const pl = plantilla!;
    // Reserva: el índice único (prospecto_id, tipo) impide una segunda.
    const { data: reserva, error: eR } = await db
      .from("captacion_envios")
      .insert({
        company_id: companyId,
        prospecto_id: prop.prospecto_id,
        campana_id: prop.campana_id,
        plantilla_id: pl.id,
        tipo: "documento",
        estado: "reclamado",
        programado_at: ahora.toISOString(),
      })
      .select("id")
      .single();
    if (eR) {
      if ((eR as { code?: string }).code === "23505") {
        throw new Error("Ya se intentó mandar la propuesta con la plantilla a este negocio: no se repite.");
      }
      throw new Error(`No se pudo reservar el envío: ${eR.message}`);
    }
    const envioId = (reserva as { id: string }).id;
    const parametro = pl.variablesCuerpo === 1 ? parametroNombre(prop.nombre_negocio) : null;
    try {
      wamid = await enviarPlantillaConComponentes(con.token, con.phoneNumberId, para, {
        nombre: pl.nombre,
        idioma: pl.idioma,
        components: componentesEnvioDocumento({ documento: doc, parametroCuerpo: parametro }),
      });
    } catch (e) {
      const conocido = e instanceof ErrorMeta;
      await db
        .from("captacion_envios")
        .update({
          estado: "fallido",
          error_codigo: conocido ? e.codigo : null,
          error_texto: (conocido ? e.message : `Resultado desconocido: ${e instanceof Error ? e.message : String(e)}`).slice(0, 500),
        })
        .eq("company_id", companyId)
        .eq("id", envioId);
      throw e;
    }
    // Ya ha salido: lo que sigue no lanza.
    const { error: eE } = await db
      .from("captacion_envios")
      .update({ estado: "enviado", wamid, enviado_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", envioId);
    if (eE) console.error("[captacion/propuesta] plantilla enviada pero no anotada", eE.message);
    cuerpoBandeja = renderizarCuerpo(pl.cuerpo, parametro ?? prop.nombre_negocio) ?? pie;
  }

  const { error: eM } = await db.from("captacion_mensajes").insert({
    company_id: companyId,
    conversacion_id: destino.conversacionId,
    direccion: "saliente",
    autor: "sistema",
    origen: "api",
    tipo: "documento",
    cuerpo: cuerpoBandeja,
    wamid,
    estado: "enviado",
    meta_at: new Date().toISOString(),
    media_id_meta: mediaId,
    media_mime: "application/pdf",
    media_nombre: nombreFichero,
  });
  if (eM) console.error("[captacion/propuesta] enviada pero no guardada en la bandeja", eM.message);
  const { error } = await db
    .from("captacion_propuestas")
    .update({ media_id_meta: mediaId, enviada_at: new Date().toISOString(), envio_error: null })
    .eq("company_id", companyId)
    .eq("id", prop.id);
  if (error) console.error("[captacion/propuesta] enviada pero no anotada", error.message);
  return { via, wamid };
}
