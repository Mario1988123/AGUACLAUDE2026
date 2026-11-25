import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { telefonosDeHtml, type CandidatoTelefono } from "./busqueda-logica";

/**
 * Lectura de la web de un negocio para sacar el teléfono que publica.
 *
 * Las URL vienen de OpenStreetMap, es decir, de cualquiera: antes de pedir
 * nada se comprueba que el destino no sea una IP privada, localhost ni la
 * red interna de la nube (SSRF). Las redirecciones se siguen a mano y se
 * vuelve a comprobar cada salto. Se lee como mucho 1,5 MB y 8 s por página.
 *
 * Amable con los servidores ajenos: una petición cada vez, con pausa, y un
 * agente de usuario que dice quién mira.
 */
export const AGENTE =
  "HidromanagerCaptacion/1.0 (+https://vercomi.com; lectura de datos de contacto publicados)";

const MAX_BYTES = 1_500_000;
const TIEMPO_MS = 8_000;
const MAX_SALTOS = 3;
const PAUSA_MS = 600;

function ipPrivada(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return m ? ipPrivada(m[1]!) : false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

async function destinoPermitido(u: URL): Promise<boolean> {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (isIP(host)) return !ipPrivada(host);
  try {
    const ips = await lookup(host, { all: true });
    return ips.length > 0 && ips.every((r) => !ipPrivada(r.address));
  } catch {
    return false;
  }
}

/** Devuelve el HTML (recortado) y la URL final, o null si no se puede leer. */
export async function leerPagina(url: string): Promise<{ html: string; url: string } | null> {
  let actual: URL;
  try {
    actual = new URL(url);
  } catch {
    return null;
  }
  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    if (!(await destinoPermitido(actual))) return null;
    let res: Response;
    try {
      res = await fetch(actual, {
        headers: { "User-Agent": AGENTE, Accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIEMPO_MS),
        cache: "no-store",
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try {
        actual = new URL(loc, actual);
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) return null;
    const tipo = res.headers.get("content-type") ?? "";
    if (tipo && !/html|xml|text\/plain/i.test(tipo)) return null;
    const html = await leerConTope(res);
    return html == null ? null : { html, url: actual.toString() };
  }
  return null;
}

async function leerConTope(res: Response): Promise<string | null> {
  if (!res.body) return null;
  const lector = res.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await lector.read();
      if (done || !value) break;
      trozos.push(value);
      total += value.byteLength;
    }
  } catch {
    /* corte de red: nos quedamos con lo leído */
  } finally {
    lector.cancel().catch(() => {});
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(trozos).subarray(0, MAX_BYTES));
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Teléfonos publicados en la web del negocio: la portada y, si en ella no hay
 * ningún móvil, /contacto. Cada candidato lleva la URL donde
 * estaba (prueba de origen).
 */
export async function telefonosDeWeb(web: string): Promise<Array<CandidatoTelefono & { url: string }>> {
  const out: Array<CandidatoTelefono & { url: string }> = [];
  const vistos = new Set<string>();
  let base: URL;
  try {
    base = new URL(web);
  } catch {
    return out;
  }
  const paginas = [base.toString(), new URL("/contacto", base).toString()];
  for (const [i, p] of paginas.entries()) {
    if (i > 0) {
      if (out.some((c) => /^\+34(6\d|7[1-4])/.test(c.e164))) break;
      await pausa(PAUSA_MS);
    }
    const r = await leerPagina(p);
    if (!r) continue;
    for (const c of telefonosDeHtml(r.html)) {
      if (vistos.has(c.e164)) continue;
      vistos.add(c.e164);
      out.push({ ...c, url: r.url });
    }
  }
  return out;
}
