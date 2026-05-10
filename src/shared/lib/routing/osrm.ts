/**
 * OSRM (Open Source Routing Machine) — cálculo de ruta en carretera
 * usando el servicio público demo (router.project-osrm.org). Gratis, sin
 * API key. Limit ~1 req/s razonable para uso interno (no para picos masivos).
 *
 * Devuelve distancia en metros y duración en segundos. Si falla, devuelve null
 * y el llamante puede pedir al usuario que meta los km a mano.
 */

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

export interface RouteResult {
  /** Distancia en metros */
  distance_m: number;
  /** Duración estimada en segundos */
  duration_s: number;
}

export async function calculateDrivingRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<RouteResult | null> {
  try {
    // OSRM espera coords como lon,lat (no lat,lon)
    const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=false&alternatives=false&steps=false`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 }, // cache 24h, una ruta no cambia mucho
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{ distance: number; duration: number }>;
    };
    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) return null;
    const r = data.routes[0]!;
    return {
      distance_m: Math.round(r.distance),
      duration_s: Math.round(r.duration),
    };
  } catch (e) {
    console.error("[osrm] route failed:", e);
    return null;
  }
}
