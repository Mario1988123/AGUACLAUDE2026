"use server";

import { requireSession } from "@/shared/lib/auth/session";
import {
  canUseGoogleMaps,
  trackGoogleApiCall,
} from "@/shared/lib/google-maps/config";
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
 * Reverse geocoding híbrido: Google si la empresa tiene gmaps activo +
 * key + cap disponible, OSM Nominatim si no. Track automático en
 * google_api_usage para contabilidad por empresa.
 *
 * Devuelve null si ambos fallan — el caller debe poder gestionar el
 * "no se pudo identificar".
 */
export async function reverseGeocodeAction(
  lat: number,
  lng: number,
): Promise<ReverseGeocode | null> {
  // Resolver sesión y empresa para decidir Google vs OSM
  let companyId: string | null = null;
  let userId: string | null = null;
  try {
    const s = await requireSession();
    companyId = s.company_id ?? null;
    userId = s.user_id;
  } catch {
    /* sin sesión: directo a Nominatim */
  }

  if (companyId) {
    const gm = await canUseGoogleMaps({ companyId });
    if (gm.ok) {
      const result = await reverseGoogle(lat, lng, gm.key);
      if (result) {
        await trackGoogleApiCall({
          companyId,
          api: "geocoding",
          endpoint: "reverse",
          userId,
        });
        return result;
      }
      // Si Google falla, registramos error y caemos a Nominatim
      await trackGoogleApiCall({
        companyId,
        api: "geocoding",
        endpoint: "reverse",
        userId,
        success: false,
        errorCode: "no_result",
      });
    }
  }

  return reverseNominatim(lat, lng);
}

export async function forwardGeocodeAction(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  let companyId: string | null = null;
  let userId: string | null = null;
  try {
    const s = await requireSession();
    companyId = s.company_id ?? null;
    userId = s.user_id;
  } catch {
    /* sin sesión: Nominatim */
  }

  if (companyId) {
    const gm = await canUseGoogleMaps({ companyId });
    if (gm.ok) {
      const result = await forwardGoogle(query, gm.key);
      if (result) {
        await trackGoogleApiCall({
          companyId,
          api: "geocoding",
          endpoint: "forward",
          userId,
        });
        return result;
      }
      await trackGoogleApiCall({
        companyId,
        api: "geocoding",
        endpoint: "forward",
        userId,
        success: false,
        errorCode: "no_result",
      });
    }
  }

  return forwardNominatim(query);
}

// ─────────────────────────────────────────────────────────────────────
// Google implementations
// ─────────────────────────────────────────────────────────────────────

async function reverseGoogle(
  lat: number,
  lng: number,
  key: string,
): Promise<ReverseGeocode | null> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("language", "es");
    url.searchParams.set("region", "es");
    url.searchParams.set("key", key);
    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results?: Array<{
        formatted_address: string;
        address_components: Array<{
          long_name: string;
          short_name: string;
          types: string[];
        }>;
      }>;
    };
    if (data.status !== "OK" || !data.results?.length) return null;
    const r = data.results[0]!;
    const comp = (type: string) =>
      r.address_components.find((c) => c.types.includes(type))?.long_name ?? null;
    const route = comp("route") ?? "";
    const { type, rest } = detectStreetType(route);
    return {
      street_type: type,
      street: rest,
      street_number: comp("street_number"),
      postal_code: comp("postal_code"),
      city:
        comp("locality") ??
        comp("administrative_area_level_3") ??
        comp("administrative_area_level_4") ??
        null,
      province:
        comp("administrative_area_level_2") ??
        comp("administrative_area_level_1") ??
        null,
      display_name: r.formatted_address,
    };
  } catch {
    return null;
  }
}

async function forwardGoogle(
  query: string,
  key: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("language", "es");
    url.searchParams.set("region", "es");
    url.searchParams.set("components", "country:ES");
    url.searchParams.set("key", key);
    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results?: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };
    if (data.status !== "OK" || !data.results?.length) return null;
    const loc = data.results[0]!.geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Nominatim fallback (idéntico al anterior)
// ─────────────────────────────────────────────────────────────────────

async function reverseNominatim(
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

async function forwardNominatim(
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
