"use server";

import { canUseGoogleMaps, trackGoogleApiCall } from "./config";

interface LatLng {
  lat: number;
  lng: number;
}

interface OptimizeResult {
  /** Orden de waypoints (índices sobre el array de entrada) */
  order: number[];
  /** Distancia total en km */
  totalKm: number;
  /** Duración total en segundos */
  totalSeconds: number;
}

/**
 * Llama a Routes API v2 (computeRoutes) con `optimizeWaypointOrder=true`
 * para reordenar paradas de forma óptima usando tráfico real. Si la
 * empresa no tiene la feature `smart_routes` o la llamada falla,
 * devuelve null y el caller debe usar Haversine + nearest-neighbor.
 */
export async function optimizeRouteWithGoogle(args: {
  companyId: string;
  userId?: string | null;
  start: LatLng;
  waypoints: LatLng[];
  /** Si el técnico vuelve a su base al acabar el día, end = start. */
  end?: LatLng;
}): Promise<OptimizeResult | null> {
  const gm = await canUseGoogleMaps({
    companyId: args.companyId,
    feature: "smart_routes",
  });
  if (!gm.ok) return null;
  if (args.waypoints.length === 0) return null;

  const body = {
    origin: { location: { latLng: args.start } },
    destination: { location: { latLng: args.end ?? args.start } },
    intermediates: args.waypoints.map((w) => ({ location: { latLng: w } })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    optimizeWaypointOrder: true,
    languageCode: "es",
    regionCode: "ES",
  };
  try {
    const res = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": gm.key,
          "X-Goog-FieldMask":
            "routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      await trackGoogleApiCall({
        companyId: args.companyId,
        api: "routes_optimize",
        endpoint: "computeRoutes",
        userId: args.userId ?? null,
        success: false,
        errorCode: `http_${res.status}`,
      });
      return null;
    }
    const data = (await res.json()) as {
      routes?: Array<{
        distanceMeters?: number;
        duration?: string; // "1234s"
        optimizedIntermediateWaypointIndex?: number[];
      }>;
    };
    const r = data.routes?.[0];
    if (!r) return null;
    await trackGoogleApiCall({
      companyId: args.companyId,
      api: "routes_optimize",
      endpoint: "computeRoutes",
      userId: args.userId ?? null,
    });
    return {
      order: r.optimizedIntermediateWaypointIndex ?? args.waypoints.map((_, i) => i),
      totalKm: (r.distanceMeters ?? 0) / 1000,
      totalSeconds: parseDurationSeconds(r.duration ?? "0s"),
    };
  } catch {
    await trackGoogleApiCall({
      companyId: args.companyId,
      api: "routes_optimize",
      endpoint: "computeRoutes",
      userId: args.userId ?? null,
      success: false,
      errorCode: "fetch_failed",
    });
    return null;
  }
}

/**
 * Distance Matrix entre dos puntos. Útil para mileage real (gastos).
 * Devuelve km y segundos según ruta de coche con tráfico. null si la
 * feature `directions` no está activa.
 */
export async function computeDistanceWithGoogle(args: {
  companyId: string;
  userId?: string | null;
  origin: LatLng;
  destination: LatLng;
}): Promise<{ km: number; seconds: number } | null> {
  const gm = await canUseGoogleMaps({
    companyId: args.companyId,
    feature: "directions",
  });
  if (!gm.ok) return null;

  const body = {
    origin: { location: { latLng: args.origin } },
    destination: { location: { latLng: args.destination } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    languageCode: "es",
    regionCode: "ES",
  };
  try {
    const res = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": gm.key,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      await trackGoogleApiCall({
        companyId: args.companyId,
        api: "routes_compute",
        endpoint: "computeRoutes",
        userId: args.userId ?? null,
        success: false,
        errorCode: `http_${res.status}`,
      });
      return null;
    }
    const data = (await res.json()) as {
      routes?: Array<{ distanceMeters?: number; duration?: string }>;
    };
    const r = data.routes?.[0];
    if (!r) return null;
    await trackGoogleApiCall({
      companyId: args.companyId,
      api: "routes_compute",
      endpoint: "computeRoutes",
      userId: args.userId ?? null,
    });
    return {
      km: (r.distanceMeters ?? 0) / 1000,
      seconds: parseDurationSeconds(r.duration ?? "0s"),
    };
  } catch {
    await trackGoogleApiCall({
      companyId: args.companyId,
      api: "routes_compute",
      endpoint: "computeRoutes",
      userId: args.userId ?? null,
      success: false,
      errorCode: "fetch_failed",
    });
    return null;
  }
}

/**
 * Verifica con Roads API que un punto GPS está sobre una calle real.
 * Si la distancia del snap es muy grande (> umbralM), probablemente el
 * técnico no está realmente en la dirección (campo, edificio interior,
 * pueblo sin cobertura cartográfica, GPS spoof). Devuelve {snapped,
 * distanceM} si la feature está activa; null si no.
 */
export async function snapToRoadWithGoogle(args: {
  companyId: string;
  userId?: string | null;
  lat: number;
  lng: number;
}): Promise<{ lat: number; lng: number; distanceM: number } | null> {
  const gm = await canUseGoogleMaps({
    companyId: args.companyId,
    feature: "anti_fraud_roads",
  });
  if (!gm.ok) return null;
  try {
    const url = new URL("https://roads.googleapis.com/v1/nearestRoads");
    url.searchParams.set("points", `${args.lat},${args.lng}`);
    url.searchParams.set("key", gm.key);
    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    if (!res.ok) {
      await trackGoogleApiCall({
        companyId: args.companyId,
        api: "roads",
        endpoint: "nearestRoads",
        userId: args.userId ?? null,
        success: false,
        errorCode: `http_${res.status}`,
      });
      return null;
    }
    const data = (await res.json()) as {
      snappedPoints?: Array<{
        location: { latitude: number; longitude: number };
      }>;
    };
    const p = data.snappedPoints?.[0];
    if (!p) {
      await trackGoogleApiCall({
        companyId: args.companyId,
        api: "roads",
        endpoint: "nearestRoads",
        userId: args.userId ?? null,
      });
      return null;
    }
    await trackGoogleApiCall({
      companyId: args.companyId,
      api: "roads",
      endpoint: "nearestRoads",
      userId: args.userId ?? null,
    });
    const dist = haversineMeters(
      args.lat,
      args.lng,
      p.location.latitude,
      p.location.longitude,
    );
    return {
      lat: p.location.latitude,
      lng: p.location.longitude,
      distanceM: dist,
    };
  } catch {
    await trackGoogleApiCall({
      companyId: args.companyId,
      api: "roads",
      endpoint: "nearestRoads",
      userId: args.userId ?? null,
      success: false,
      errorCode: "fetch_failed",
    });
    return null;
  }
}

function parseDurationSeconds(d: string): number {
  // Routes API devuelve formato "1234s"
  const m = /^(\d+)s$/.exec(d);
  return m ? parseInt(m[1]!, 10) : 0;
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
