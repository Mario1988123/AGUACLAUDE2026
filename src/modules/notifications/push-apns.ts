import "server-only";

import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import http2 from "node:http2";
import { avisarUnaVez, type AvisoPush, type ResultadoEnvioNativo } from "./push-tipos";

/**
 * Envío de push a iPhone por APNs DIRECTO (HTTP/2 + JWT ES256 firmado con la
 * clave .p8 del equipo de Apple). Sin Firebase y sin dependencias: solo
 * node:http2 y node:crypto.
 *
 * Variables de entorno (todas en Vercel; ninguna es NEXT_PUBLIC):
 *   · APNS_KEY_P8     contenido del AuthKey_XXXXXXXXXX.p8 (con BEGIN/END). Vale
 *                     pegado tal cual, con los saltos como "\n" o en base64.
 *   · APNS_KEY_ID     Key ID de esa clave (10 caracteres).
 *   · APNS_TEAM_ID    Team ID de la cuenta de Apple (10 caracteres).
 *   · APNS_BUNDLE_ID  opcional; por defecto es.hidromanager.crm.
 *   · APNS_ENTORNO    opcional; "production" (por defecto: TestFlight y App
 *                     Store) o "sandbox" (solo apps lanzadas desde Xcode).
 *
 * Si falta alguna de las tres primeras, no se envía nada y queda un aviso en
 * el log.
 */

const BUNDLE_POR_DEFECTO = "es.hidromanager.crm";
const HOST_PRODUCCION = "https://api.push.apple.com";
const HOST_SANDBOX = "https://api.sandbox.push.apple.com";
const ESPERA_MS = 8000;
// Apple acepta un mismo JWT entre 20 y 60 minutos: se renueva a los 45.
const VIDA_JWT_MS = 45 * 60 * 1000;

interface ConfigApns {
  clave: KeyObject;
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
}

let jwtEnCache: { valor: string; creado: number; keyId: string } | null = null;

/** Acepta la clave pegada tal cual, con "\n" literales o en base64. */
function normalizarPem(bruto: string): string {
  let texto = bruto.trim();
  if (
    (texto.startsWith('"') && texto.endsWith('"')) ||
    (texto.startsWith("'") && texto.endsWith("'"))
  ) {
    texto = texto.slice(1, -1);
  }
  if (!texto.includes("BEGIN")) {
    try {
      const decodificado = Buffer.from(texto, "base64").toString("utf8");
      if (decodificado.includes("BEGIN")) texto = decodificado;
    } catch {
      /* se queda como estaba y fallará al crear la clave */
    }
  }
  return texto.replace(/\\n/g, "\n").replace(/\r/g, "");
}

function leerConfig(): ConfigApns | null {
  const p8 = process.env.APNS_KEY_P8;
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  if (!p8 || !keyId || !teamId) {
    avisarUnaVez(
      "apns-sin-config",
      "APNs sin configurar (faltan APNS_KEY_P8, APNS_KEY_ID o APNS_TEAM_ID): no se envía push a iPhone.",
    );
    return null;
  }
  let clave: KeyObject;
  try {
    clave = createPrivateKey(normalizarPem(p8));
  } catch {
    avisarUnaVez(
      "apns-clave-mala",
      "APNS_KEY_P8 no es una clave .p8 válida: no se envía push a iPhone.",
    );
    return null;
  }
  const entorno = (process.env.APNS_ENTORNO ?? "production").trim().toLowerCase();
  return {
    clave,
    keyId,
    teamId,
    bundleId: process.env.APNS_BUNDLE_ID?.trim() || BUNDLE_POR_DEFECTO,
    host: entorno === "sandbox" ? HOST_SANDBOX : HOST_PRODUCCION,
  };
}

function b64url(valor: string | Buffer): string {
  return Buffer.from(valor).toString("base64url");
}

function jwtProveedor(cfg: ConfigApns): string {
  const ahora = Date.now();
  if (
    jwtEnCache &&
    jwtEnCache.keyId === cfg.keyId &&
    ahora - jwtEnCache.creado < VIDA_JWT_MS
  ) {
    return jwtEnCache.valor;
  }
  const cabecera = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const carga = b64url(
    JSON.stringify({ iss: cfg.teamId, iat: Math.floor(ahora / 1000) }),
  );
  const firma = sign("sha256", Buffer.from(`${cabecera}.${carga}`), {
    key: cfg.clave,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const valor = `${cabecera}.${carga}.${firma}`;
  jwtEnCache = { valor, creado: ahora, keyId: cfg.keyId };
  return valor;
}

/** apns-collapse-id admite como mucho 64 bytes. */
function idDeAgrupacion(tag?: string): string | undefined {
  if (!tag) return undefined;
  const limpio = tag.replace(/[^\x20-\x7E]/g, "");
  if (!limpio) return undefined;
  return Buffer.byteLength(limpio) <= 64 ? limpio : limpio.slice(0, 64);
}

function enviarUno(
  sesion: http2.ClientHttp2Session,
  cfg: ConfigApns,
  jwt: string,
  token: string,
  cuerpo: string,
  agrupacion: string | undefined,
): Promise<ResultadoEnvioNativo> {
  return new Promise((resolver) => {
    let terminado = false;
    const acabar = (r: ResultadoEnvioNativo) => {
      if (terminado) return;
      terminado = true;
      resolver(r);
    };
    try {
      const cabeceras: http2.OutgoingHttpHeaders = {
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": cfg.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      };
      if (agrupacion) cabeceras["apns-collapse-id"] = agrupacion;

      const peticion = sesion.request(cabeceras);
      let estado = 0;
      let respuesta = "";
      peticion.setEncoding("utf8");
      peticion.setTimeout(ESPERA_MS, () => {
        peticion.close(http2.constants.NGHTTP2_CANCEL);
        acabar({ token, ok: false, borrar: false, motivo: "tiempo agotado" });
      });
      peticion.on("response", (h) => {
        estado = Number(h[":status"] ?? 0);
      });
      peticion.on("data", (trozo: string) => {
        respuesta += trozo;
      });
      peticion.on("error", (e: Error) => {
        acabar({ token, ok: false, borrar: false, motivo: e.message });
      });
      peticion.on("end", () => {
        if (estado === 200) {
          acabar({ token, ok: true, borrar: false });
          return;
        }
        let motivo = `HTTP ${estado}`;
        try {
          const json = JSON.parse(respuesta) as { reason?: string };
          if (json.reason) motivo = json.reason;
        } catch {
          /* cuerpo vacío o no JSON */
        }
        // 410 Unregistered: la app se desinstaló o el token caducó.
        // 400 BadDeviceToken / DeviceTokenNotForTopic: el token no vale para
        // esta app o este entorno. La app lo vuelve a registrar en el
        // siguiente arranque, así que borrarlo no pierde nada.
        const borrar =
          estado === 410 ||
          motivo === "BadDeviceToken" ||
          motivo === "DeviceTokenNotForTopic";
        if (motivo === "ExpiredProviderToken" || motivo === "InvalidProviderToken") {
          jwtEnCache = null;
        }
        acabar({ token, ok: false, borrar, motivo });
      });
      peticion.end(cuerpo);
    } catch (e) {
      acabar({
        token,
        ok: false,
        borrar: false,
        motivo: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

/**
 * Envía el mismo aviso a varios iPhone por una sola conexión HTTP/2.
 * Nunca lanza: devuelve un resultado por token.
 */
export async function enviarApns(
  tokens: string[],
  aviso: AvisoPush,
): Promise<ResultadoEnvioNativo[]> {
  if (tokens.length === 0) return [];
  const cfg = leerConfig();
  if (!cfg) return [];

  const fallo = (motivo: string): ResultadoEnvioNativo[] =>
    tokens.map((token) => ({ token, ok: false, borrar: false, motivo }));

  let jwt: string;
  try {
    jwt = jwtProveedor(cfg);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn(`[push] APNs: no se pudo firmar el JWT (${motivo})`);
    return fallo(motivo);
  }

  const cuerpo = JSON.stringify({
    aps: {
      alert: aviso.body ? { title: aviso.title, body: aviso.body } : { title: aviso.title },
      sound: "default",
      ...(aviso.tag ? { "thread-id": aviso.tag } : {}),
    },
    // Fuera de "aps": lo lee la web al tocar la notificación (data.url).
    url: aviso.url ?? "/",
    ...(aviso.tag ? { tag: aviso.tag } : {}),
  });
  const agrupacion = idDeAgrupacion(aviso.tag);

  let sesion: http2.ClientHttp2Session;
  try {
    sesion = http2.connect(cfg.host);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn(`[push] APNs: no se pudo conectar (${motivo})`);
    return fallo(motivo);
  }
  // Sin este oyente, un error de conexión tumbaría el proceso.
  sesion.on("error", (e: Error) => {
    console.warn(`[push] APNs: error de conexión (${e.message})`);
  });

  try {
    const resultados = await Promise.all(
      tokens.map((token) => enviarUno(sesion, cfg, jwt, token, cuerpo, agrupacion)),
    );
    for (const r of resultados) {
      if (!r.ok) console.warn(`[push] APNs rechazó un envío: ${r.motivo}`);
    }
    return resultados;
  } finally {
    try {
      sesion.close();
    } catch {
      /* ya cerrada */
    }
  }
}
