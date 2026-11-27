/**
 * Lógica pura de la fase 3 (plantillas, envío con tope y respuestas «Sí»/«No»).
 * Sin base de datos ni red, para probarla con vitest.
 *
 * Documentación de Meta comprobada el 2026-11-27:
 *  · Crear plantilla: POST /{waba_id}/message_templates con name (minúsculas,
 *    números y guiones bajos), language, category (MARKETING…),
 *    parameter_format (POSITIONAL por defecto) y components. Cuerpo hasta 1024
 *    caracteres y, si lleva variables, ejemplo obligatorio en
 *    example.body_text = [["valor"]]. Pie hasta 60. Botones QUICK_REPLY con
 *    texto de hasta 25 caracteres. Respuesta: { id, status, category }.
 *    https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.md
 *    https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management.md
 *    https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api.md
 *    https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/custom-marketing-templates.md
 *  · Enviar con carga en los botones: components con
 *    { type: "button", sub_type: "quick_reply", index, parameters: [{ type: "payload", payload }] }.
 *    La pulsación vuelve en el webhook como type "button" con button.payload.
 *    https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/
 *    https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button.md
 *    [NV] La página de la Cloud API que lo explica ya no existe; el ejemplo
 *    leído (API local, misma estructura) usa index numérico y los fragmentos de
 *    la referencia de la Cloud API lo dan como texto ("0"). Se manda como texto,
 *    que es lo que usan los ejemplos de la Cloud API para los botones de URL.
 *    Tampoco se ha encontrado el límite de longitud de la carga: las nuestras
 *    tienen 39 caracteres.
 *  · Mensaje interactivo con botones (dentro de la ventana): type
 *    "interactive", interactive.type "button", body.text (≤ 1024),
 *    action.buttons[] = { type: "reply", reply: { id (≤ 256), title (≤ 20) } },
 *    hasta 3 botones. Admite `recipient` (BSUID) en lugar de `to`.
 *    https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages.md
 *  · Error 131026: mensaje no entregable; entre los motivos, que el número no
 *    sea de WhatsApp.
 *    https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

// -----------------------------------------------------------------------------
// Plantillas: creación
// -----------------------------------------------------------------------------

export const MAX_CUERPO_PLANTILLA = 1024;
export const MAX_PIE_PLANTILLA = 60;
export const MAX_TEXTO_BOTON_PLANTILLA = 25;
export const BOTON_SI = "Sí, cuéntame";
export const BOTON_NO = "No, gracias";

export type UsoPlantilla = "primer_contacto" | "recordatorio";

export interface PlantillaNueva {
  nombre: string;
  cuerpo: string;
  pie: string | null;
  /** Valor de ejemplo de {{1}} (nombre de un negocio) que pide Meta. */
  ejemplo: string;
}

/**
 * Propuesta de texto para Infinity Aqua (alquiler y venta de dispensadores de
 * agua en Mallorca). Solo se prellena en el formulario: NO se envía a Meta
 * hasta que una persona la revise y pulse «Enviar a Meta». {{1}} es el nombre
 * del negocio. No promete nada que no se haya comprobado (mantenimiento,
 * precios, plazos): eso lo da el comercial.
 */
export const PROPUESTA_INFINITY: Record<UsoPlantilla, PlantillaNueva> = {
  primer_contacto: {
    nombre: "infinity_primer_contacto_v1",
    cuerpo:
      "Hola, {{1}}. Te escribimos de Infinity Aqua, en Mallorca: alquilamos y vendemos dispensadores de agua para negocios.\n\n¿Quieres que te enviemos la información con los equipos que mejor encajan en un negocio como el vuestro?",
    pie: "Pulsa «No, gracias» y no te escribiremos más.",
    ejemplo: "Cafetería Es Born",
  },
  recordatorio: {
    nombre: "infinity_recordatorio_v1",
    cuerpo:
      "Hola de nuevo, {{1}}. Hace unos días te escribimos de Infinity Aqua por los dispensadores de agua para negocios, en alquiler o en venta, aquí en Mallorca.\n\n¿Te enviamos la información? Si no te interesa, no volveremos a escribirte.",
    pie: "Pulsa «No, gracias» y no te escribiremos más.",
    ejemplo: "Cafetería Es Born",
  },
};

/** Variables {{n}} o {{nombre}} del texto, en orden de aparición. */
export function variablesDe(texto: string): string[] {
  return [...texto.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]!);
}

export function validarPlantillaNueva(p: PlantillaNueva): { ok: true } | { ok: false; error: string } {
  if (!/^[a-z0-9_]{1,512}$/.test(p.nombre)) {
    return { ok: false, error: "El nombre solo admite minúsculas sin tildes, números y guiones bajos." };
  }
  if (p.nombre.length > 60) return { ok: false, error: "Pon un nombre más corto (60 caracteres como mucho)." };
  const cuerpo = p.cuerpo.trim();
  if (!cuerpo) return { ok: false, error: "Escribe el texto del mensaje." };
  if (cuerpo.length > MAX_CUERPO_PLANTILLA) {
    return { ok: false, error: `El texto no puede pasar de ${MAX_CUERPO_PLANTILLA} caracteres.` };
  }
  const vars = variablesDe(cuerpo);
  if (vars.length !== 1 || vars[0] !== "1") {
    return { ok: false, error: "El texto tiene que llevar {{1}} (el nombre del negocio) una sola vez y ninguna otra variable." };
  }
  // Meta rechaza las plantillas que empiezan o acaban con una variable [NV: regla
  // de revisión de Meta, no comprobada en la documentación de hoy].
  if (/^\{\{/.test(cuerpo) || /\}\}[\s.!?¡¿]*$/.test(cuerpo)) {
    return { ok: false, error: "El texto no puede empezar ni acabar con {{1}}." };
  }
  if (p.pie && p.pie.trim().length > MAX_PIE_PLANTILLA) {
    return { ok: false, error: `El pie no puede pasar de ${MAX_PIE_PLANTILLA} caracteres.` };
  }
  if (p.pie && variablesDe(p.pie).length > 0) return { ok: false, error: "El pie no admite variables." };
  if (!p.ejemplo.trim()) return { ok: false, error: "Pon un nombre de negocio de ejemplo: Meta lo pide para revisarla." };
  return { ok: true };
}

/** Cuerpo de POST /{waba_id}/message_templates para una plantilla de captación. */
export function cuerpoCreacionPlantilla(p: PlantillaNueva): {
  name: string;
  language: string;
  category: "MARKETING";
  parameter_format: "POSITIONAL";
  components: Array<Record<string, unknown>>;
} {
  const components: Array<Record<string, unknown>> = [
    { type: "BODY", text: p.cuerpo.trim(), example: { body_text: [[p.ejemplo.trim()]] } },
  ];
  if (p.pie && p.pie.trim()) components.push({ type: "FOOTER", text: p.pie.trim() });
  components.push({
    type: "BUTTONS",
    buttons: [
      { type: "QUICK_REPLY", text: BOTON_SI },
      { type: "QUICK_REPLY", text: BOTON_NO },
    ],
  });
  return { name: p.nombre, language: "es", category: "MARKETING", parameter_format: "POSITIONAL", components };
}

// -----------------------------------------------------------------------------
// Plantillas: análisis de las que vienen de Meta
// -----------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

function lista(v: unknown): Obj[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
}

function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export interface AnalisisPlantilla {
  /** Formato de la cabecera en mayúsculas (TEXT, IMAGE, DOCUMENT…) o null si no tiene. */
  formatoCabecera: string | null;
  cuerpo: string | null;
  /** Número de variables del cuerpo. */
  variablesCuerpo: number;
  /** La cabecera lleva texto con variables o un medio (no se sabe rellenar). */
  cabeceraConParametros: boolean;
  /** Índice del botón «Sí» y del «No» (respuestas rápidas), si los hay. */
  botones: { si: number; no: number } | null;
  /** Número de botones de respuesta rápida. */
  respuestasRapidas: number;
  /** Hay botones de URL con variable, de copiar código… que no sabemos rellenar. */
  otrosBotonesConParametros: boolean;
}

/** Lee los componentes guardados (tal como los da Meta o como los mandamos). */
export function analizarPlantilla(componentes: unknown): AnalisisPlantilla {
  const comps = lista(componentes);
  const tipo = (c: Obj) => String(c.type ?? "").toUpperCase();
  const body = comps.find((c) => tipo(c) === "BODY");
  const header = comps.find((c) => tipo(c) === "HEADER");
  const cuerpo = typeof body?.text === "string" ? body.text : null;
  const formatoCab = String(header?.format ?? "").toUpperCase();
  const cabeceraConParametros = Boolean(
    header &&
      ((formatoCab === "TEXT" && typeof header.text === "string" && variablesDe(header.text).length > 0) ||
        ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(formatoCab)),
  );

  const botones = lista(comps.find((c) => tipo(c) === "BUTTONS")?.buttons);
  let si = -1;
  let no = -1;
  let respuestasRapidas = 0;
  let otrosBotonesConParametros = false;
  botones.forEach((b, i) => {
    const t = String(b.type ?? "").toUpperCase();
    if (t === "QUICK_REPLY") {
      respuestasRapidas++;
      const texto = sinTildes(String(b.text ?? "")).toLowerCase().trim();
      if (si < 0 && /^si\b/.test(texto)) si = i;
      else if (no < 0 && /^no\b/.test(texto)) no = i;
    } else if (t === "URL" && typeof b.url === "string" && variablesDe(b.url).length > 0) {
      otrosBotonesConParametros = true;
    } else if (t === "COPY_CODE" || t === "OTP" || t === "FLOW" || t === "CATALOG" || t === "MPM") {
      otrosBotonesConParametros = true;
    }
  });

  return {
    formatoCabecera: header ? formatoCab || "TEXT" : null,
    cuerpo,
    variablesCuerpo: cuerpo ? new Set(variablesDe(cuerpo)).size : 0,
    cabeceraConParametros,
    botones: si >= 0 && no >= 0 ? { si, no } : null,
    respuestasRapidas,
    otrosBotonesConParametros,
  };
}

/**
 * ¿Sirve para captación (primer contacto o recordatorio)? Hace falta un «Sí»
 * y un «No» de respuesta rápida, como mucho una variable en el cuerpo (el
 * nombre del negocio) y nada más que rellenar.
 */
export function plantillaSirveParaCaptacion(a: AnalisisPlantilla): { ok: true } | { ok: false; motivo: string } {
  if (!a.cuerpo) return { ok: false, motivo: "No tiene texto." };
  if (a.variablesCuerpo > 1) return { ok: false, motivo: "Tiene más de una variable; solo se sabe rellenar el nombre del negocio." };
  if (a.cabeceraConParametros) return { ok: false, motivo: "Tiene una cabecera con variable o con imagen." };
  if (a.otrosBotonesConParametros) return { ok: false, motivo: "Tiene botones que piden datos." };
  if (!a.botones) return { ok: false, motivo: "Le faltan los botones «Sí…» y «No…» de respuesta rápida." };
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Fase 8: plantilla con cabecera DOCUMENT (la propuesta fuera de las 24 h)
// -----------------------------------------------------------------------------
//
// Documentación de Meta comprobada el 2026-11-27:
//  · Creación: componente { type: "HEADER", format: "DOCUMENT", example:
//    { header_handle: ["<handle>"] } }. «You must upload all media with the
//    Resumable Upload API»; el handle sale de esa subida.
//    https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.md
//    https://developers.facebook.com/docs/graph-api/guides/upload
//  · Envío: components con { type: "header", parameters: [{ type: "<medio>",
//    "<medio>": { link | id } }] } (el ejemplo de Meta es de imagen y recomienda
//    el id de un medio subido antes que el enlace).
//    https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-media.md
//    El objeto `document` lleva link, id y filename:
//    https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/media-headers.md
//    https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/document-messages.md
//  [NV] No se ha encontrado en la documentación de hoy un ejemplo literal de
//  plantilla con cabecera DOCUMENT (ni de creación ni de envío): se ha armado
//  con el formato de la cabecera de imagen y el objeto `document` de arriba.
//  [NV] Tampoco qué categorías admiten cabecera de documento: se ofrecen
//  utility y marketing; si Meta la recategoriza, lo dirá el webhook.

export type CategoriaDocumento = "utility" | "marketing";

export interface PlantillaDocumentoNueva extends PlantillaNueva {
  categoria: CategoriaDocumento;
}

/**
 * Texto propuesto para Infinity: solo se prellena; NO se envía a Meta hasta
 * que una persona lo revise. Responde a lo que el contacto ha pedido (dijo
 * «Sí»), sin precios ni promesas.
 */
export const PROPUESTA_DOCUMENTO: PlantillaDocumentoNueva = {
  nombre: "infinity_propuesta_documento_v1",
  cuerpo:
    "Hola, {{1}}. Te enviamos el documento con la información que nos pediste sobre los dispensadores de agua para tu negocio.\n\nSi tienes cualquier duda, contesta a este mensaje y te atendemos.",
  pie: "Infinity Aqua",
  ejemplo: "Cafetería Es Born",
  categoria: "utility",
};

export function validarPlantillaDocumento(p: PlantillaDocumentoNueva): { ok: true } | { ok: false; error: string } {
  if (p.categoria !== "utility" && p.categoria !== "marketing") {
    return { ok: false, error: "La categoría tiene que ser de servicio (utility) o de marketing." };
  }
  return validarPlantillaNueva(p);
}

/** Cuerpo de POST /{waba_id}/message_templates para la plantilla de documento. */
export function cuerpoCreacionPlantillaDocumento(
  p: PlantillaDocumentoNueva,
  headerHandle: string,
): {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  parameter_format: "POSITIONAL";
  components: Array<Record<string, unknown>>;
} {
  const components: Array<Record<string, unknown>> = [
    { type: "HEADER", format: "DOCUMENT", example: { header_handle: [headerHandle] } },
    { type: "BODY", text: p.cuerpo.trim(), example: { body_text: [[p.ejemplo.trim()]] } },
  ];
  if (p.pie && p.pie.trim()) components.push({ type: "FOOTER", text: p.pie.trim() });
  return {
    name: p.nombre,
    language: "es",
    category: p.categoria === "utility" ? "UTILITY" : "MARKETING",
    parameter_format: "POSITIONAL",
    components,
  };
}

/**
 * ¿Sirve para mandar la propuesta? Cabecera DOCUMENT, cuerpo con como mucho
 * una variable (el nombre del negocio) y ningún botón que pida datos.
 */
export function plantillaSirveParaDocumento(a: AnalisisPlantilla): { ok: true } | { ok: false; motivo: string } {
  if (a.formatoCabecera !== "DOCUMENT") return { ok: false, motivo: "No lleva un documento en la cabecera." };
  if (!a.cuerpo) return { ok: false, motivo: "No tiene texto." };
  if (a.variablesCuerpo > 1) return { ok: false, motivo: "Tiene más de una variable; solo se sabe rellenar el nombre del negocio." };
  if (a.otrosBotonesConParametros) return { ok: false, motivo: "Tiene botones que piden datos." };
  return { ok: true };
}

/** components del envío de la plantilla de documento. */
export function componentesEnvioDocumento(args: {
  documento: { mediaId?: string | null; link?: string | null; nombreFichero: string };
  parametroCuerpo: string | null;
}): Array<Record<string, unknown>> {
  const d = args.documento;
  if (!d.mediaId && !d.link) throw new Error("Falta el medio o el enlace del documento.");
  const components: Array<Record<string, unknown>> = [
    {
      type: "header",
      parameters: [
        {
          type: "document",
          document: { ...(d.mediaId ? { id: d.mediaId } : { link: d.link }), filename: d.nombreFichero },
        },
      ],
    },
  ];
  if (args.parametroCuerpo != null) {
    components.push({ type: "body", parameters: [{ type: "text", text: args.parametroCuerpo }] });
  }
  return components;
}

/** ¿Se puede mandar a mano desde la bandeja? Basta con que no pida más que el nombre. */
export function plantillaSirveParaBandeja(a: AnalisisPlantilla): boolean {
  return Boolean(a.cuerpo) && a.variablesCuerpo <= 1 && !a.cabeceraConParametros && !a.otrosBotonesConParametros;
}

/** Texto tal como lo verá el contacto ({{1}} sustituido), para guardarlo en la bandeja. */
export function renderizarCuerpo(cuerpo: string | null, nombre: string): string | null {
  if (!cuerpo) return null;
  return cuerpo.replace(/\{\{\s*[a-z0-9_]+\s*\}\}/gi, nombre);
}

/** Nombre del negocio para {{1}}: Meta no admite saltos de línea ni tabuladores en los parámetros [NV]. */
export function parametroNombre(nombre: string | null | undefined): string {
  const t = (nombre ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 60);
  return t || "hola";
}

// -----------------------------------------------------------------------------
// Cargas de los botones
// -----------------------------------------------------------------------------

export type AccionBoton = "si" | "no" | "llamar" | "ahora_no";

const PREFIJOS: Record<string, AccionBoton> = { SI: "si", NO: "no", LLAMAR: "llamar", AHORA_NO: "ahora_no" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «SI:<envio_id>», «NO:<envio_id>» (plantilla) · «LLAMAR:<prospecto_id>», «AHORA_NO:<prospecto_id>» (interactivo). */
export function cargaBoton(accion: AccionBoton, id: string): string {
  const p = Object.entries(PREFIJOS).find(([, a]) => a === accion)![0];
  return `${p}:${id}`;
}

export function leerCargaBoton(carga: string | null | undefined): { accion: AccionBoton; id: string } | null {
  const m = /^([A-Z_]+):(.+)$/.exec((carga ?? "").trim());
  if (!m) return null;
  const accion = PREFIJOS[m[1]!];
  if (!accion || !UUID.test(m[2]!)) return null;
  return { accion, id: m[2]!.toLowerCase() };
}

// -----------------------------------------------------------------------------
// Respuestas
// -----------------------------------------------------------------------------

/**
 * Baja por texto, ANTES de nada (decisión 8): «baja», «no me escribas», «no
 * me interesa», «stop», «borra mi número», «denuncia»… y un «no» o «no,
 * gracias» a secas. Sin IA. Prefiere bloquear de más: un falso positivo
 * cuesta un contacto; un falso negativo, una queja.
 */
const PATRONES_BAJA: RegExp[] = [
  /^\s*baja\b/,
  /\b(de|la|una) baja\b/,
  /\bdar(me|nos|le|les)? de baja\b/,
  /\bno (me|nos) (escrib|mand|envi|molest|contact|vuelv)/,
  /\bno (me|nos) (interesa|interesan)\b/,
  /\bno (estoy|estamos) interesad/,
  /\bdej(a|ad|en|e)(me|nos)? (de escribir|en paz|tranquil)/,
  /\bstop\b/,
  /\bunsubscribe\b/,
  /\bborr(a|ad|e|en|ar)(me)? (mi|el|nuestro|este) (numero|telefono|movil|contacto)/,
  /\bborr(a|ad|e|en|ar)me\b/,
  /\bdenuncia/,
  /\bspam\b/,
  /^\s*no[\s,.!]*(gracias|grasias)?[\s.!]*$/,
  /^\s*no,? (quiero|queremos|necesito|necesitamos)\b/,
];

export function normalizarTexto(t: string): string {
  return sinTildes(t).toLowerCase().replace(/\s+/g, " ").trim();
}

export function esBajaPorTexto(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = normalizarTexto(texto);
  if (!t) return false;
  return PATRONES_BAJA.some((r) => r.test(t));
}

export type ClaseRespuesta =
  | { clase: "boton"; accion: AccionBoton; id: string }
  | { clase: "baja" }
  | { clase: "texto" }
  | { clase: "otro" };

/**
 * Qué ha contestado. La carga del botón manda (nunca el texto del botón); en
 * un texto, la baja va antes que cualquier otra cosa.
 */
export function clasificarRespuesta(m: { tipo: string; cuerpo: string | null; payloadBoton: string | null }): ClaseRespuesta {
  if (m.tipo === "boton") {
    const c = leerCargaBoton(m.payloadBoton);
    if (c) return { clase: "boton", ...c };
    // Un botón sin nuestra carga (plantilla creada a mano, sin payload) no se
    // interpreta por su texto: va a la bandeja como texto libre.
    return esBajaPorTexto(m.cuerpo) ? { clase: "baja" } : { clase: "texto" };
  }
  if (m.tipo === "texto") return esBajaPorTexto(m.cuerpo) ? { clase: "baja" } : { clase: "texto" };
  return { clase: "otro" };
}

// -----------------------------------------------------------------------------
// Envío: horario, tope y ritmo
// -----------------------------------------------------------------------------

export interface Horario {
  dias: number[];
  desde: string;
  hasta: string;
}

const HORARIO_POR_DEFECTO: Horario = { dias: [1, 2, 3, 4, 5], desde: "10:00", hasta: "19:00" };

function minutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

export function leerHorario(v: unknown): Horario {
  const o = (v && typeof v === "object" ? v : {}) as Obj;
  const dias = Array.isArray(o.dias) ? o.dias.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7) : null;
  const desde = typeof o.desde === "string" && minutos(o.desde) != null ? o.desde : null;
  const hasta = typeof o.hasta === "string" && minutos(o.hasta) != null ? o.hasta : null;
  if (!dias || !desde || !hasta || minutos(desde)! >= minutos(hasta)!) return HORARIO_POR_DEFECTO;
  return { dias, desde, hasta };
}

/** Día ISO (1 = lunes … 7 = domingo) y minuto del día en hora de Madrid. */
export function horaMadrid(ahora: Date): { dia: number; minuto: number } {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  const dias: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { dia: dias[p("weekday")] ?? 0, minuto: Number(p("hour")) * 60 + Number(p("minute")) };
}

/** Minutos que quedan de la ventana de envío de hoy (0 si está cerrada). */
export function minutosRestantesHorario(h: Horario, ahora: Date): number {
  const { dia, minuto } = horaMadrid(ahora);
  if (!h.dias.includes(dia)) return 0;
  const d = minutos(h.desde)!;
  const a = minutos(h.hasta)!;
  if (minuto < d || minuto >= a) return 0;
  return a - minuto;
}

export interface TramoEscalado {
  dias: number;
  tope: number;
}

export function leerEscalado(v: unknown): TramoEscalado[] {
  return lista(v)
    .map((t) => ({ dias: Number(t.dias), tope: Number(t.tope) }))
    .filter((t) => Number.isInteger(t.dias) && t.dias > 0 && Number.isInteger(t.tope) && t.tope >= 0);
}

/**
 * Tope de la campaña hoy según el escalado (§4.3.6): 50 los 3 primeros días,
 * 100 los 3 siguientes y luego `tope_diario`. Nunca por encima de `tope_diario`.
 */
export function topeCampanaHoy(escalado: TramoEscalado[], topeDiario: number, diasDesdeLanzamiento: number): number {
  let acumulado = 0;
  for (const t of escalado) {
    acumulado += t.dias;
    if (diasDesdeLanzamiento < acumulado) return Math.min(t.tope, topeDiario);
  }
  return topeDiario;
}

/** Tope de la plataforma por empresa y día (decisión de Mario). */
export const TOPE_DIARIO_PLATAFORMA = 200;

/**
 * Presupuesto rodante de 24 h de la empresa: límite de Meta menos el margen,
 * con el techo de 200, menos lo ya enviado (§4.3.4). Nunca negativo.
 */
export function presupuestoEmpresa(limiteMeta: number, margen: number, enviados24h: number): number {
  const techo = Math.min(Math.max(limiteMeta - margen, 0), TOPE_DIARIO_PLATAFORMA);
  return Math.max(techo - enviados24h, 0);
}

export const MAX_POR_PASADA = 25;
export const MINUTOS_ENTRE_PASADAS = 10;

/**
 * Cuántos salen en esta pasada (§4.3.7): lo que queda ÷ pasadas que quedan en
 * la ventana, con un máximo de 25, para repartirlos a lo largo del horario.
 */
export function trozoDePasada(restante: number, minutosRestantes: number): number {
  if (restante <= 0 || minutosRestantes <= 0) return 0;
  const pasadas = Math.max(1, Math.ceil(minutosRestantes / MINUTOS_ENTRE_PASADAS));
  return Math.min(MAX_POR_PASADA, Math.ceil(restante / pasadas));
}

// -----------------------------------------------------------------------------
// Errores de Meta al enviar
// -----------------------------------------------------------------------------

/** Número sin WhatsApp (o no entregable): el prospecto pasa a `fallido`. */
export const ERROR_SIN_WHATSAPP = 131026;

/**
 * Errores que cortan la tanda entera de la empresa (§4.3.11): límites de
 * envío, cuenta restringida, plantilla que no existe o no cuadra, token.
 * Verificados en support/error-codes el 2026-11-27: 80007, 130429, 131048,
 * 368, 131031, 132000, 132001. [NV] 190 (token caducado, error general de la
 * Graph API) y 131000 (error genérico).
 */
const ERRORES_DE_CORTE = new Set([80007, 130429, 131048, 368, 131031, 132000, 132001, 190, 131000]);

export function errorCortaTanda(codigo: number | null): boolean {
  return codigo != null && ERRORES_DE_CORTE.has(codigo);
}

/** Estados de un envío desde los que se puede pasar a `nuevo` (solo hacia delante). */
export function estadosEnvioAnteriores(nuevo: "entregado" | "leido" | "fallido"): string[] {
  if (nuevo === "entregado") return ["enviado"];
  if (nuevo === "leido") return ["enviado", "entregado"];
  return ["enviado", "entregado"];
}
