import "server-only";

/**
 * Google Places Text Search (New), solo como complemento de OSM.
 *
 * Se piden `places.id`, `places.websiteUri` y `places.location`. El primero es
 * lo único que se guarda; la web se usa en la misma ejecución para ir al
 * sitio del negocio y sacar de ahí nombre y teléfono; la ubicación solo
 * sirve para descartar lo que cae fuera del radio y no se guarda.
 * `websiteUri` hace que la llamada se facture como Text Search Enterprise,
 * cuyo tramo gratuito son 1.000 al mes (barrido.ts de Osmofilter, medido el
 * 07-08-2026).
 *
 * Clave: GOOGLE_PLACES_SERVER_KEY, de servidor, restringida a «Places API
 * (New)» en el proyecto aguaclaude. Nunca la NEXT_PUBLIC_GOOGLE_MAPS_KEY.
 */
const URL_PLACES = "https://places.googleapis.com/v1/places:searchText";
const CAMPOS = "places.id,places.websiteUri,places.location,nextPageToken";

/** Tope de llamadas al mes, de todas las empresas. Decisión de Mario: 1.000. */
export function topePlacesMensual(): number {
  const n = Number(process.env.PLACES_TOPE_MENSUAL);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 1000) : 1000;
}

export function placesConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_SERVER_KEY);
}

export interface SitioPlaces {
  id: string;
  websiteUri?: string;
  location?: { latitude: number; longitude: number };
}

export async function textSearch(
  cuerpo: Record<string, unknown>,
  limiteMs: number,
): Promise<{ places: SitioPlaces[]; nextPageToken?: string }> {
  const clave = process.env.GOOGLE_PLACES_SERVER_KEY;
  if (!clave) throw new Error("Falta GOOGLE_PLACES_SERVER_KEY en el servidor.");
  const res = await fetch(URL_PLACES, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": clave,
      "X-Goog-FieldMask": CAMPOS,
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(Math.max(5_000, Math.min(20_000, limiteMs))),
    cache: "no-store",
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
    const err = new Error(`Places respondió ${res.status}${j?.error?.status ? ` (${j.error.status})` : ""}`) as Error & {
      reintentable?: boolean;
    };
    err.reintentable = res.status === 429 || res.status >= 500;
    throw err;
  }
  const j = (await res.json()) as { places?: SitioPlaces[]; nextPageToken?: string };
  return { places: j.places ?? [], nextPageToken: j.nextPageToken };
}
