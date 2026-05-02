/**
 * Geocoding usando Nominatim (OpenStreetMap, gratis, sin API key).
 * Limit 1 req/seg → uso ocasional desde el navegador, no para batch.
 */

export interface ReverseGeocode {
  street_type: string;
  street: string;
  street_number: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  display_name: string;
}

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

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocode | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=es`,
      {
        headers: { Accept: "application/json" },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      address?: {
        road?: string;
        pedestrian?: string;
        house_number?: string;
        postcode?: string;
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
        province?: string;
        state?: string;
      };
    };
    if (!data.address) return null;
    const a = data.address;
    const rawRoad = a.road ?? a.pedestrian ?? "";
    const { type, rest } = detectStreetType(rawRoad);
    return {
      street_type: type,
      street: rest,
      street_number: a.house_number ?? null,
      postal_code: a.postcode ?? null,
      city: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
      province: a.province ?? a.state ?? null,
      display_name: data.display_name ?? "",
    };
  } catch {
    return null;
  }
}

export async function forwardGeocode(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=es&limit=1`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0]!.lat), lng: parseFloat(data[0]!.lon) };
  } catch {
    return null;
  }
}
