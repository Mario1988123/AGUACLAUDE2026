"use client";

/**
 * Loader perezoso del bundle de Google Maps JS API. Se reutiliza una
 * sola carga por sesión; las libraries adicionales se cargan on-demand
 * mediante `google.maps.importLibrary` (API moderna, v=weekly).
 *
 * Devuelve `null` si la empresa no tiene Google Maps Tools activo —
 * el caller debe caer a Leaflet/OSM.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const libraryPromises = new Map<GmapsLibrary, Promise<any>>();

/**
 * Carga el bundle de Google Maps. La primera llamada inyecta el
 * `<script>` con bootstrap moderno (sin `libraries=` en la URL) y
 * después usa `google.maps.importLibrary(lib)` para cargar cada library
 * solo cuando alguien la pide. Esto evita el bug clásico: si el primer
 * caller pasa [], el script se carga sin places y un caller posterior
 * con ["places"] no lo encuentra.
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

  // Si el script aún no se ha cargado, lo inyectamos. Usamos el
  // bootstrap loader inline (recomendado por Google) que define
  // `google.maps.importLibrary` antes de cargar nada más.
  if (!w.google?.maps?.importLibrary && !loaderPromise) {
    loaderPromise = new Promise((resolve) => {
      // Si ya hay un script en curso (otro componente lo añadió),
      // esperamos a su load.
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-google-maps-loader="1"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(w.google ?? null));
        existing.addEventListener("error", () => resolve(null));
        return;
      }

      // Inline bootstrap (mismo patrón que el snippet oficial de Google).
      // Define google.maps con importLibrary disponible inmediatamente.
      // Documentación: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
      const script = document.createElement("script");
      script.dataset.googleMapsLoader = "1";
      script.text = `
        (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=\`https://maps.\${c}apis.com/maps/api/js?\`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
          key: ${JSON.stringify(ck.key)},
          v: "weekly",
          language: "es",
          region: "ES"
        });
      `;
      document.head.appendChild(script);

      // Poll hasta que google.maps esté disponible.
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (w.google?.maps?.importLibrary) {
          clearInterval(iv);
          resolve(w.google);
        } else if (tries > 100) {
          clearInterval(iv);
          resolve(null);
        }
      }, 50);
    });
  }

  await loaderPromise;
  if (!w.google?.maps?.importLibrary) return null;

  // Cargar las libraries solicitadas usando importLibrary (cached por
  // library entre llamadas).
  for (const lib of libraries) {
    if (!libraryPromises.has(lib)) {
      libraryPromises.set(lib, w.google.maps.importLibrary(lib));
    }
    try {
      await libraryPromises.get(lib);
    } catch {
      libraryPromises.delete(lib);
      return null;
    }
  }

  return w.google;
}

/** Limpia el cache del client-key tras un cambio de config. */
export function resetGoogleMapsClientKeyCache() {
  clientKeyCache = null;
  clientKeyCacheAt = 0;
}
