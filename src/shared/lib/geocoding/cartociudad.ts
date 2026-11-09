import "server-only";

/**
 * Cliente de CartoCiudad (IGN). Gratis, sin clave, licencia CC BY 4.0: hay
 * que citarlo («Direcciones: CartoCiudad (IGN, CC BY 4.0)») donde se use.
 *
 * Endpoints VERIFICADOS con curl el 2026-11-09 (no uses otros sin probarlos):
 *  · candidatesJsonp?q=&limit=[&cod_postal_filter=] → callback([...])
 *    (cod_postal_filter sí filtra; municipio_filter exige el nombre oficial
 *    exacto —«Palma de Mallorca» devuelve [] — y por eso filtramos en local).
 *  · find?q=                → objeto (portal exacto) o HTTP 204 si nada.
 *  · find?id=&type=         → objeto con lat/lng (centro de la calle, de la
 *    población o del municipio).
 *  · reverseGeocode?lat=&lon= → objeto del portal más cercano.
 *
 * No hay límite publicado: timeout corto y, si falla, null (el que llama cae
 * a Google / Nominatim).
 */

import {
  aCandidato,
  aCandidatos,
  parsearJsonp,
  type CandidatoCartociudad,
} from "./direccion-texto";

const BASE = "https://www.cartociudad.es/geocoder/api/geocoder";
const TIMEOUT_MS = 4000;

async function pedir(ruta: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}/${ruta}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json, text/javascript" },
      next: { revalidate: 3600 },
    });
    if (!res.ok || res.status === 204) return null;
    return parsearJsonp(await res.text());
  } catch (e) {
    console.error(`[cartociudad] ${ruta} falló:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function candidatosCartociudad(
  q: string,
  opciones: { cp?: string | null; municipio?: string | null; limite?: number } = {},
): Promise<CandidatoCartociudad[]> {
  const params: Record<string, string> = { q, limit: String(opciones.limite ?? 10) };
  if (opciones.cp && /^\d{5}$/.test(opciones.cp)) params.cod_postal_filter = opciones.cp;
  // Verificado: «Inca» filtra; «Palma de Mallorca» devuelve [] (exige el
  // nombre oficial exacto). Por eso siempre se filtra también en local.
  if (opciones.municipio) params.municipio_filter = opciones.municipio;
  return aCandidatos(await pedir("candidatesJsonp", params));
}

/** Mejor coincidencia para un texto («calle monges 17, inca»). */
export async function buscarCartociudad(q: string): Promise<CandidatoCartociudad | null> {
  return aCandidato(await pedir("find", { q }));
}

/** Coordenadas de un candidato que vino con lat/lng = 0 (callejero, población…). */
export async function detalleCartociudad(id: string, type: string): Promise<CandidatoCartociudad | null> {
  if (!id || !type) return null;
  return aCandidato(await pedir("find", { id, type }));
}

export async function reverseCartociudad(lat: number, lng: number): Promise<CandidatoCartociudad | null> {
  return aCandidato(await pedir("reverseGeocode", { lat: String(lat), lon: String(lng) }));
}
