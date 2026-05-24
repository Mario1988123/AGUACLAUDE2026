"use client";

/**
 * Loader perezoso del bundle de Google Maps JS API. Se reutiliza una
 * sola carga por sesión y libraries solicitadas. Si la empresa no tiene
 * la feature `interactive_maps` activa, devuelve `null` y el caller
 * debe caer a Leaflet/OSM.
 *
 *   const g = await loadGoogleMaps(["places"]);
 *   if (!g) { fallbackToLeaflet(); return; }
 *   const map = new g.maps.Map(el, opts);
 */

type GmapsLibrary = "places" | "marker" | "geometry" | "drawing" | "visualization";

interface ClientKeyResponse {
  key: string | null;
  mode: "disabled" | "shared_key" | "own_key";
}

let clientKeyCache: ClientKeyResponse | null = null;
let clientKeyCacheAt = 0;
const CLIENT_KEY_TTL_MS = 60_000;

async function fetchClientKey(): Promise<ClientKeyResponse> {
  if (clientKeyCache && Date.now() - clientKeyCacheAt < CLIENT_KEY_TTL_MS) {
    return clientKeyCache;
  }
  try {
    const res = await fetch("/api/maps/client-key", { cache: "no-store" });
    if (!res.ok) {
      clientKeyCache = { key: null, mode: "disabled" };
    } else {
      clientKeyCache = (await res.json()) as ClientKeyResponse;
    }
  } catch {
    clientKeyCache = { key: null, mode: "disabled" };
  }
  clientKeyCacheAt = Date.now();
  return clientKeyCache;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loaderPromise: Promise<any> | null = null;
let loadedLibraries = new Set<GmapsLibrary>();

/**
 * Carga el bundle `https://maps.googleapis.com/maps/api/js` con las
 * libraries indicadas. Devuelve el objeto `google` global del bundle
 * o `null` si la empresa no tiene gmaps activo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadGoogleMaps(
  libraries: GmapsLibrary[] = [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (typeof window === "undefined") return null;
  const ck = await fetchClientKey();
  if (!ck.key) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.google?.maps) return w.google;

  if (loaderPromise) return loaderPromise;

  const libs = Array.from(new Set([...loadedLibraries, ...libraries]));
  loadedLibraries = new Set(libs);
  const url = new URL("https://maps.googleapis.com/maps/api/js");
  url.searchParams.set("key", ck.key);
  url.searchParams.set("v", "weekly");
  url.searchParams.set("language", "es");
  url.searchParams.set("region", "ES");
  if (libs.length > 0) url.searchParams.set("libraries", libs.join(","));
  url.searchParams.set("loading", "async");

  loaderPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps-loader="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(w.google ?? null));
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const s = document.createElement("script");
    s.src = url.toString();
    s.async = true;
    s.defer = true;
    s.dataset.googleMapsLoader = "1";
    s.onload = () => resolve(w.google ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });

  return loaderPromise;
}

/** Limpia el cache del client-key tras un cambio de config. */
export function resetGoogleMapsClientKeyCache() {
  clientKeyCache = null;
  clientKeyCacheAt = 0;
}
