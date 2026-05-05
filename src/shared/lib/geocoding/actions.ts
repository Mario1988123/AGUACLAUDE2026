"use server";

import type { ReverseGeocode } from "./nominatim";

const STREET_TYPE_MAP: Record<string, string> = {
  calle: "calle",
  avenida: "avenida",
  avda: "avenida",
  plaza: "plaza",
  paseo: "paseo",
  ronda: "ronda",
  camino: "camino",
  carretera: "carretera",
  glorieta: "glorieta",
  travesia: "travesia",
  travesía: "travesia",
  urbanización: "urbanizacion",
  urbanizacion: "urbanizacion",
  polígono: "poligono",
  poligono: "poligono",
  vía: "via",
  via: "via",
};

function detectStreetType(road: string): { type: string; rest: string } {
  const lower = road.toLowerCase().trim();
  for (const key of Object.keys(STREET_TYPE_MAP)) {
    if (lower.startsWith(`${key} `)) {
      return { type: STREET_TYPE_MAP[key]!, rest: road.slice(key.length).trim() };
    }
  }
  return { type: "calle", rest: road };
}

/**
 * Reverse-geocode server-side. Mejor que el cliente porque:
 *  - User-Agent custom (Nominatim lo exige).
 *  - Sin problemas de CORS / rate-limit por IP del cliente.
 *  - El cliente sólo recibe un objeto pequeño y normalizado.
 */
export async function reverseGeocodeAction(
  lat: number,
  lng: number,
): Promise<ReverseGeocode | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=es&zoom=18`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "AguaClaude-CRM/1.0 (contact@aguaclaude.local)",
          "Accept-Language": "es-ES,es",
        },
        // Cache muy corto para no machacar Nominatim con la misma coord
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      address?: {
        road?: string;
        pedestrian?: string;
        residential?: string;
        cycleway?: string;
        path?: string;
        footway?: string;
        house_number?: string;
        postcode?: string;
        city?: string;
        town?: string;
        village?: string;
        hamlet?: string;
        suburb?: string;
        city_district?: string;
        municipality?: string;
        province?: string;
        state?: string;
        county?: string;
      };
    };
    if (!data.address) return null;
    const a = data.address;
    // Más campos posibles para "calle" en Nominatim — ampliamos cobertura
    const rawRoad =
      a.road ??
      a.pedestrian ??
      a.residential ??
      a.cycleway ??
      a.path ??
      a.footway ??
      "";
    const { type, rest } = detectStreetType(rawRoad);
    return {
      street_type: type,
      street: rest,
      street_number: a.house_number ?? null,
      postal_code: a.postcode ?? null,
      city:
        a.city ??
        a.town ??
        a.village ??
        a.hamlet ??
        a.suburb ??
        a.city_district ??
        a.municipality ??
        null,
      province: a.province ?? a.state ?? a.county ?? null,
      display_name: data.display_name ?? "",
    };
  } catch {
    return null;
  }
}

export async function forwardGeocodeAction(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=es&limit=1`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "AguaClaude-CRM/1.0 (contact@aguaclaude.local)",
        },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0]!.lat), lng: parseFloat(data[0]!.lon) };
  } catch {
    return null;
  }
}
