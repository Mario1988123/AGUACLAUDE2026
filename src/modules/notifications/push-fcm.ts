import "server-only";

import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import {
  avisarUnaVez,
  CANAL_ANDROID,
  ICONO_ANDROID,
  type AvisoPush,
  type ResultadoEnvioNativo,
} from "./push-tipos";

/**
 * Envío de push a Android por FCM HTTP v1. Firebase se usa SOLO como pasarela
 * de mensajería. Sin firebase-admin ni google-auth-library: el token de acceso
 * de Google se pide con un JWT RS256 firmado con node:crypto.
 *
 * Variable de entorno (en Vercel; no es NEXT_PUBLIC):
 *   · FIREBASE_SERVICE_ACCOUNT_JSON  el JSON entero de la cuenta de servicio
 *     (Firebase → Configuración del proyecto → Cuentas de servicio → Generar
 *     nueva clave privada). Vale pegado tal cual o en base64.
 *
 * Si falta o no es válida, no se envía nada y queda un aviso en el log.
 */

const ALCANCE = "https://www.googleapis.com/auth/firebase.messaging";
const URL_TOKEN_POR_DEFECTO = "https://oauth2.googleapis.com/token";
const ESPERA_MS = 8000;

interface CuentaServicio {
  projectId: string;
  clientEmail: string;
  clave: KeyObject;
  tokenUri: string;
}

let accesoEnCache: { valor: string; caduca: number; cuenta: string } | null = null;

function leerCuenta(): CuentaServicio | null {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!bruto) {
    avisarUnaVez(
      "fcm-sin-config",
      "FCM sin configurar (falta FIREBASE_SERVICE_ACCOUNT_JSON): no se envía push a Android.",
    );
    return null;
  }
  try {
    let texto = bruto.trim();
    if (!texto.startsWith("{")) texto = Buffer.from(texto, "base64").toString("utf8");
    const json = JSON.parse(texto) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
      token_uri?: string;
    };
    if (!json.project_id || !json.client_email || !json.private_key) {
      throw new Error("faltan project_id, client_email o private_key");
    }
    return {
      projectId: json.project_id,
      clientEmail: json.client_email,
      clave: createPrivateKey(json.private_key.replace(/\\n/g, "\n")),
      tokenUri: json.token_uri || URL_TOKEN_POR_DEFECTO,
    };
  } catch (e) {
    avisarUnaVez(
      "fcm-config-mala",
      `FIREBASE_SERVICE_ACCOUNT_JSON no es una cuenta de servicio válida (${
        e instanceof Error ? e.message : "error"
      }): no se envía push a Android.`,
    );
    return null;
  }
}

function b64url(valor: string | Buffer): string {
  return Buffer.from(valor).toString("base64url");
}

/** Token de acceso de Google (dura 1 h; se reutiliza hasta 5 min antes). */
async function tokenDeAcceso(cuenta: CuentaServicio): Promise<string> {
  const ahora = Date.now();
  if (
    accesoEnCache &&
    accesoEnCache.cuenta === cuenta.clientEmail &&
    accesoEnCache.caduca > ahora
  ) {
    return accesoEnCache.valor;
  }
  const iat = Math.floor(ahora / 1000);
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const carga = b64url(
    JSON.stringify({
      iss: cuenta.clientEmail,
      scope: ALCANCE,
      aud: cuenta.tokenUri,
      iat,
      exp: iat + 3600,
    }),
  );
  const firma = sign("RSA-SHA256", Buffer.from(`${cabecera}.${carga}`), cuenta.clave).toString(
    "base64url",
  );
  const r = await fetch(cuenta.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${cabecera}.${carga}.${firma}`,
    }),
    signal: AbortSignal.timeout(ESPERA_MS),
    cache: "no-store",
  });
  const json = (await r.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;
  if (!r.ok || !json?.access_token) {
    throw new Error(
      `Google no dio token de acceso (HTTP ${r.status}${
        json?.error ? `: ${json.error} ${json.error_description ?? ""}` : ""
      })`,
    );
  }
  accesoEnCache = {
    valor: json.access_token,
    caduca: ahora + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000,
    cuenta: cuenta.clientEmail,
  };
  return json.access_token;
}

async function enviarUno(
  cuenta: CuentaServicio,
  acceso: string,
  token: string,
  aviso: AvisoPush,
): Promise<ResultadoEnvioNativo> {
  try {
    // "data" solo admite cadenas. La web lee data.url al tocar la notificación.
    const datos: Record<string, string> = { url: aviso.url ?? "/" };
    if (aviso.tag) datos.tag = aviso.tag;

    const r = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cuenta.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${acceso}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: aviso.title,
              ...(aviso.body ? { body: aviso.body } : {}),
            },
            data: datos,
            android: {
              priority: "HIGH",
              notification: {
                channel_id: CANAL_ANDROID,
                icon: ICONO_ANDROID,
                sound: "default",
                ...(aviso.tag ? { tag: aviso.tag } : {}),
              },
            },
          },
        }),
        signal: AbortSignal.timeout(ESPERA_MS),
        cache: "no-store",
      },
    );
    if (r.ok) return { token, ok: true, borrar: false };

    const json = (await r.json().catch(() => null)) as {
      error?: {
        status?: string;
        message?: string;
        details?: Array<{ errorCode?: string }>;
      };
    } | null;
    const codigo =
      json?.error?.details?.find((d) => d.errorCode)?.errorCode ??
      json?.error?.status ??
      `HTTP ${r.status}`;
    if (r.status === 401) accesoEnCache = null;
    // UNREGISTERED: la app se desinstaló o el token caducó.
    // SENDER_ID_MISMATCH: el token es de otro proyecto de Firebase.
    // INVALID_ARGUMENT solo se borra si el mensaje habla del token (también
    // sale por un cuerpo mal formado, y eso no es culpa del dispositivo).
    const borrar =
      codigo === "UNREGISTERED" ||
      codigo === "SENDER_ID_MISMATCH" ||
      (codigo === "INVALID_ARGUMENT" &&
        /registration token|not a valid FCM/i.test(json?.error?.message ?? ""));
    return { token, ok: false, borrar, motivo: codigo };
  } catch (e) {
    return {
      token,
      ok: false,
      borrar: false,
      motivo: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Envía el mismo aviso a varios Android. Nunca lanza: devuelve un resultado
 * por token.
 */
export async function enviarFcm(
  tokens: string[],
  aviso: AvisoPush,
): Promise<ResultadoEnvioNativo[]> {
  if (tokens.length === 0) return [];
  const cuenta = leerCuenta();
  if (!cuenta) return [];

  let acceso: string;
  try {
    acceso = await tokenDeAcceso(cuenta);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn(`[push] FCM: ${motivo}`);
    return tokens.map((token) => ({ token, ok: false, borrar: false, motivo }));
  }

  const resultados = await Promise.all(
    tokens.map((token) => enviarUno(cuenta, acceso, token, aviso)),
  );
  for (const r of resultados) {
    if (!r.ok) console.warn(`[push] FCM rechazó un envío: ${r.motivo}`);
  }
  return resultados;
}
