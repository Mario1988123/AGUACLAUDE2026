import "server-only";

/**
 * Cliente mínimo de la Graph API de Meta para la Cloud API de WhatsApp.
 *
 * Endpoints comprobados en developers.facebook.com el 2026-11-25
 * (embedded-signup/onboarding-customers-as-a-tech-provider, phone-numbers,
 * templates/template-management). Todas las llamadas son de servidor a
 * servidor: el token nunca llega al navegador.
 *
 * Versión: META_GRAPH_VERSION o v27.0 (la vigente a 2026-11-25). Los ejemplos
 * de Meta usan v21.0, que caduca el 21-01-2027: no se fija en el código.
 */
const VERSION_POR_DEFECTO = "v27.0";
const TIEMPO_MAXIMO_MS = 15_000;

export function graphVersion(): string {
  const v = process.env.META_GRAPH_VERSION;
  return v && /^v\d+\.\d+$/.test(v) ? v : VERSION_POR_DEFECTO;
}

export class ErrorMeta extends Error {
  constructor(
    message: string,
    readonly codigo: number | null,
    readonly estadoHttp: number,
  ) {
    super(message);
    this.name = "ErrorMeta";
  }
}

interface OpcionesLlamada {
  metodo?: "GET" | "POST" | "DELETE";
  token?: string;
  cuerpo?: Record<string, unknown>;
  query?: Record<string, string>;
}

async function llamar<T>(ruta: string, o: OpcionesLlamada = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${ruta.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.cuerpo) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method: o.metodo ?? "GET",
    headers,
    body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });
  const texto = await res.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* respuesta no JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number } } | null)?.error;
    // Nunca se incluye la URL: lleva client_secret o code en la query.
    throw new ErrorMeta(
      err?.message ?? `Meta respondió ${res.status}`,
      typeof err?.code === "number" ? err.code : null,
      res.status,
    );
  }
  return json as T;
}

/** Cambia el `code` del Embedded Signup (caduca a los 5 min) por el token de negocio. */
export async function intercambiarCodigo(code: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  const secreto = process.env.META_APP_SECRET;
  if (!appId || !secreto) throw new Error("Falta META_APP_ID o META_APP_SECRET en el servidor.");
  const r = await llamar<{ access_token?: string }>("oauth/access_token", {
    query: { client_id: appId, client_secret: secreto, code },
  });
  if (!r?.access_token) throw new Error("Meta no devolvió el token de negocio.");
  return r.access_token;
}

export interface NumeroMeta {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  status?: string;
  name_status?: string;
  whatsapp_business_manager_messaging_limit?: string;
}

/** Números que el token ve en esa WABA. Sirve para no fiarse del navegador. */
export async function listarNumerosWaba(token: string, wabaId: string): Promise<NumeroMeta[]> {
  const r = await llamar<{ data?: NumeroMeta[] }>(`${encodeURIComponent(wabaId)}/phone_numbers`, {
    token,
    query: { fields: "id,display_phone_number,verified_name,quality_rating" },
  });
  return r?.data ?? [];
}

/** Ficha del número. El límite de mensajes puede no venir: no se da por hecho. */
export async function leerNumero(token: string, phoneNumberId: string): Promise<NumeroMeta> {
  try {
    return await llamar<NumeroMeta>(encodeURIComponent(phoneNumberId), {
      token,
      query: {
        fields:
          "id,display_phone_number,verified_name,quality_rating,code_verification_status,status,name_status,whatsapp_business_manager_messaging_limit",
      },
    });
  } catch (e) {
    // Si el campo nuevo del límite no se admite en el número, se repite sin él.
    if (e instanceof ErrorMeta && e.estadoHttp === 400) {
      return llamar<NumeroMeta>(encodeURIComponent(phoneNumberId), {
        token,
        query: { fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status" },
      });
    }
    throw e;
  }
}

/** Suscribe la app de Vercomi a los webhooks de la WABA del cliente. */
export async function suscribirAppAWaba(token: string, wabaId: string): Promise<void> {
  await llamar(`${encodeURIComponent(wabaId)}/subscribed_apps`, { metodo: "POST", token });
}

/** Registra el número en la Cloud API. El PIN (6 dígitos) queda como verificación en dos pasos. */
export async function registrarNumero(token: string, phoneNumberId: string, pin: string): Promise<void> {
  await llamar(`${encodeURIComponent(phoneNumberId)}/register`, {
    metodo: "POST",
    token,
    cuerpo: { messaging_product: "whatsapp", pin },
  });
}

/**
 * Texto libre dentro de la ventana de 24 h (fase 2, bandeja). Devuelve el
 * wamid. Fuera de la ventana Meta responde con el error 131047.
 *
 * Comprobado el 2026-11-27 (messages/text-messages y business-scoped-user-ids):
 * body hasta 4096 caracteres; si no hay teléfono (usuario con nombre de
 * usuario) se envía al BSUID con `recipient` en lugar de `to` (admitido desde
 * julio de 2026). Si van los dos, Meta usa `to`.
 */
export async function enviarTexto(
  token: string,
  phoneNumberId: string,
  destino: { waId: string | null; bsuid: string | null },
  cuerpo: string,
): Promise<string> {
  const a = destino.waId ? { to: destino.waId } : destino.bsuid ? { recipient: destino.bsuid } : null;
  if (!a) throw new Error("El contacto no tiene teléfono ni identificador de WhatsApp.");
  const r = await llamar<{ messages?: Array<{ id?: string }> }>(`${encodeURIComponent(phoneNumberId)}/messages`, {
    metodo: "POST",
    token,
    cuerpo: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...a,
      type: "text",
      text: { body: cuerpo, preview_url: false },
    },
  });
  const wamid = r?.messages?.[0]?.id;
  if (!wamid) throw new Error("Meta no devolvió el identificador del mensaje.");
  return wamid;
}

/**
 * Coexistencia (comprobado el 2026-11-27 en embedded-signup/custom-flows/
 * onboarding-business-app-users). Con el número en la app de WhatsApp
 * Business se espera is_on_biz_app = true y platform_type = "CLOUD_API".
 */
export async function leerEstadoCoexistencia(
  token: string,
  phoneNumberId: string,
): Promise<{ is_on_biz_app?: boolean; platform_type?: string }> {
  return llamar(encodeURIComponent(phoneNumberId), {
    token,
    query: { fields: "is_on_biz_app,platform_type" },
  });
}

/**
 * Pide a Meta los contactos («smb_app_state_sync») o el historial de chats
 * («history») de la app. Llegan después por webhook. Cada uno se puede pedir
 * UNA sola vez por alta y dentro de las 24 h; repetirlo exige desconectar y
 * volver a pasar por el alta. Devuelve el request_id (útil para soporte).
 */
export async function pedirSincronizacionApp(
  token: string,
  phoneNumberId: string,
  tipo: "smb_app_state_sync" | "history",
): Promise<string | null> {
  const r = await llamar<{ request_id?: string }>(`${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
    metodo: "POST",
    token,
    cuerpo: { messaging_product: "whatsapp", sync_type: tipo },
  });
  return r?.request_id ?? null;
}

/**
 * Da de baja el número de la Cloud API (desconexión). No vale con
 * coexistencia: Meta no admite /deregister en esos números. [NV] El endpoint
 * `/deregister` no estaba entre lo verificado el 2026-11-25: quien lo llama
 * trata el fallo como aviso, no como error.
 */
export async function desregistrarNumero(token: string, phoneNumberId: string): Promise<void> {
  await llamar(`${encodeURIComponent(phoneNumberId)}/deregister`, { metodo: "POST", token });
}

export interface PlantillaMeta {
  id: string;
  name: string;
  language: string;
  category?: string;
  status?: string;
  components?: unknown[];
  rejected_reason?: string;
}

/** Todas las plantillas de la WABA (pagina con `paging.next`, con un tope de seguridad). */
export async function listarPlantillas(token: string, wabaId: string): Promise<PlantillaMeta[]> {
  const out: PlantillaMeta[] = [];
  let after: string | undefined;
  for (let pagina = 0; pagina < 20; pagina++) {
    const query: Record<string, string> = {
      fields: "id,name,language,category,status,components,rejected_reason",
      limit: "100",
    };
    if (after) query.after = after;
    const r = await llamar<{
      data?: PlantillaMeta[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>(`${encodeURIComponent(wabaId)}/message_templates`, { token, query });
    out.push(...(r?.data ?? []));
    after = r?.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Fase 3: plantillas y botones
// -----------------------------------------------------------------------------

function destinoMeta(destino: { waId: string | null; bsuid: string | null }): Record<string, string> {
  if (destino.waId) return { to: destino.waId };
  if (destino.bsuid) return { recipient: destino.bsuid };
  throw new Error("El contacto no tiene teléfono ni identificador de WhatsApp.");
}

async function enviarMensaje(token: string, phoneNumberId: string, cuerpo: Record<string, unknown>): Promise<string> {
  const r = await llamar<{ messages?: Array<{ id?: string }> }>(`${encodeURIComponent(phoneNumberId)}/messages`, {
    metodo: "POST",
    token,
    cuerpo: { messaging_product: "whatsapp", recipient_type: "individual", ...cuerpo },
  });
  const wamid = r?.messages?.[0]?.id;
  if (!wamid) throw new Error("Meta no devolvió el identificador del mensaje.");
  return wamid;
}

/**
 * Crea una plantilla en la WABA. Meta la revisa y avisa por el webhook
 * message_template_status_update. Respuesta comprobada el 2026-11-27
 * (reference/whatsapp-business-account/message-template-api.md):
 * { id, status, category }.
 */
export async function crearPlantilla(
  token: string,
  wabaId: string,
  cuerpo: Record<string, unknown>,
): Promise<{ id: string; status: string | null; category: string | null }> {
  const r = await llamar<{ id?: string; status?: string; category?: string }>(
    `${encodeURIComponent(wabaId)}/message_templates`,
    { metodo: "POST", token, cuerpo },
  );
  if (!r?.id) throw new Error("Meta no devolvió el identificador de la plantilla.");
  return { id: r.id, status: r.status ?? null, category: r.category ?? null };
}

/**
 * Plantilla fuera de ventana, con {{1}} = nombre del negocio y, si tiene
 * botones de respuesta rápida, su carga por índice. Ver envios-logica.ts para
 * las fuentes; el índice va como texto [NV].
 */
export async function enviarPlantilla(
  token: string,
  phoneNumberId: string,
  destino: { waId: string | null; bsuid: string | null },
  plantilla: {
    nombre: string;
    idioma: string;
    parametroCuerpo: string | null;
    cargas: Array<{ indice: number; carga: string }>;
  },
): Promise<string> {
  const components: Array<Record<string, unknown>> = [];
  if (plantilla.parametroCuerpo != null) {
    components.push({ type: "body", parameters: [{ type: "text", text: plantilla.parametroCuerpo }] });
  }
  for (const c of plantilla.cargas) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(c.indice),
      parameters: [{ type: "payload", payload: c.carga }],
    });
  }
  return enviarMensaje(token, phoneNumberId, {
    ...destinoMeta(destino),
    type: "template",
    template: {
      name: plantilla.nombre,
      language: { code: plantilla.idioma },
      ...(components.length ? { components } : {}),
    },
  });
}

/**
 * Fase 8: plantilla con los `components` ya armados (cabecera de documento,
 * ver componentesEnvioDocumento en envios-logica.ts). Sale fuera de la
 * ventana de 24 h y se cobra según su categoría.
 */
export async function enviarPlantillaConComponentes(
  token: string,
  phoneNumberId: string,
  destino: { waId: string | null; bsuid: string | null },
  plantilla: { nombre: string; idioma: string; components: Array<Record<string, unknown>> },
): Promise<string> {
  return enviarMensaje(token, phoneNumberId, {
    ...destinoMeta(destino),
    type: "template",
    template: {
      name: plantilla.nombre,
      language: { code: plantilla.idioma },
      components: plantilla.components,
    },
  });
}

/**
 * Fase 8: sube el fichero de ejemplo de una plantilla con cabecera de medio y
 * devuelve su `header_handle`. Resumable Upload API, comprobada el 2026-11-27
 * en developers.facebook.com/docs/graph-api/guides/upload:
 *  1) POST /{app-id}/uploads?file_name&file_length&file_type → { id: "upload:…" }
 *  2) POST /{upload-id} con «Authorization: OAuth <token>», «file_offset: 0» y
 *     el fichero en el cuerpo → { h: "<handle>" }.
 * [NV] La guía pide un token de USUARIO; aquí se usa el token de negocio de la
 * empresa (el del Embedded Signup). No se ha comprobado que Meta lo acepte: si
 * no, la creación falla con el error de Meta y no se crea nada.
 */
export async function subirEjemploPlantilla(
  token: string,
  fichero: { bytes: Uint8Array; nombre: string; tipo: string },
): Promise<string> {
  const appId = process.env.META_APP_ID;
  if (!appId) throw new Error("Falta META_APP_ID en el servidor.");
  const sesion = await llamar<{ id?: string }>(`${encodeURIComponent(appId)}/uploads`, {
    metodo: "POST",
    token,
    query: {
      file_name: fichero.nombre,
      file_length: String(fichero.bytes.byteLength),
      file_type: fichero.tipo,
    },
  });
  const idSubida = sesion?.id;
  if (!idSubida || !/^upload:/.test(idSubida)) throw new Error("Meta no abrió la subida del ejemplo.");

  // El id lleva «upload:…»: va tal cual en la ruta (los dos puntos no se escapan).
  const res = await fetch(`https://graph.facebook.com/${graphVersion()}/${idSubida}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0" },
    body: Buffer.from(fichero.bytes),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  let json: { h?: string; error?: { message?: string; code?: number } } | null = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* respuesta no JSON */
  }
  if (!res.ok || !json?.h) {
    throw new ErrorMeta(
      json?.error?.message ?? `Meta respondió ${res.status} al subir el ejemplo`,
      typeof json?.error?.code === "number" ? json.error.code : null,
      res.status,
    );
  }
  return json.h;
}

/**
 * Mensaje con botones de respuesta (solo dentro de la ventana de 24 h).
 * Hasta 3 botones; título ≤ 20 caracteres; id ≤ 256 (comprobado el
 * 2026-11-27 en messages/interactive-reply-buttons-messages.md).
 */
export async function enviarBotones(
  token: string,
  phoneNumberId: string,
  destino: { waId: string | null; bsuid: string | null },
  texto: string,
  botones: Array<{ id: string; titulo: string }>,
): Promise<string> {
  if (botones.length < 1 || botones.length > 3) throw new Error("Entre 1 y 3 botones.");
  return enviarMensaje(token, phoneNumberId, {
    ...destinoMeta(destino),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: texto.slice(0, 1024) },
      action: {
        buttons: botones.map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.titulo.slice(0, 20) } })),
      },
    },
  });
}

/**
 * Sube un fichero a Meta para enviarlo como medio. Comprobado el 2026-11-27
 * en developers.facebook.com/docs/whatsapp/cloud-api/reference/media:
 * POST /{phone_number_id}/media, formulario con `messaging_product=whatsapp`,
 * `file` (con su tipo MIME) y `type`; responde { id }. El medio y su id
 * duran 30 días.
 */
export async function subirMedio(
  token: string,
  phoneNumberId: string,
  fichero: { bytes: Uint8Array; nombre: string; tipo: string },
): Promise<string> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", fichero.tipo);
  form.set("file", new Blob([Buffer.from(fichero.bytes)], { type: fichero.tipo }), fichero.nombre);
  const url = `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneNumberId)}/media`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  let json: { id?: string; error?: { message?: string; code?: number } } | null = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* respuesta no JSON */
  }
  if (!res.ok || !json?.id) {
    throw new ErrorMeta(
      json?.error?.message ?? `Meta respondió ${res.status} al subir el medio`,
      typeof json?.error?.code === "number" ? json.error.code : null,
      res.status,
    );
  }
  return json.id;
}

/**
 * Mensaje `document` (solo dentro de la ventana de 24 h). Comprobado el
 * 2026-11-27 en developers.facebook.com/docs/whatsapp/cloud-api/messages/
 * document-messages: `document` lleva `id` (medio subido, lo recomendado) o
 * `link` (URL pública), `caption` opcional (≤ 1024) y `filename` con su
 * extensión (WhatsApp elige el icono por ella). PDF hasta 100 MB.
 */
export async function enviarDocumento(
  token: string,
  phoneNumberId: string,
  destino: { waId: string | null; bsuid: string | null },
  documento: { mediaId?: string; link?: string; nombreFichero: string; pie?: string },
): Promise<string> {
  if (!documento.mediaId && !documento.link) throw new Error("Falta el medio o el enlace del documento.");
  return enviarMensaje(token, phoneNumberId, {
    ...destinoMeta(destino),
    type: "document",
    document: {
      ...(documento.mediaId ? { id: documento.mediaId } : { link: documento.link }),
      filename: documento.nombreFichero,
      ...(documento.pie ? { caption: documento.pie.slice(0, 1024) } : {}),
    },
  });
}
