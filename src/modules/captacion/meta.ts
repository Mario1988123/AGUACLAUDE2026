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
 * Da de baja el número de la Cloud API (desconexión). [NV] El endpoint
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
