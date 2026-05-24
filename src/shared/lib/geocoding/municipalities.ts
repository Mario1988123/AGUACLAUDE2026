"use server";

import { createClient } from "@/shared/lib/supabase/server";

/**
 * Catálogo CP↔municipio con dos niveles:
 *   1) Tabla local `postal_code_municipalities` (rápido, consistente).
 *   2) Si la tabla está vacía o no devuelve nada → fallback a Nominatim
 *      (más lento pero gratis, sin API key).
 *
 * Resultado se cachea 1h en memoria del proceso. Para invalidar tras
 * un import masivo del CSV INE, reinicia la app (o expone un botón
 * de purge si se vuelve crítico).
 */

export interface MunicipalityHit {
  municipality: string;
  province: string;
  postal_code: string;
}

const TTL_MS = 60 * 60 * 1000; // 1h
type CacheEntry<T> = { at: number; data: T };
const cpCache = new Map<string, CacheEntry<MunicipalityHit[]>>();
const muniCache = new Map<string, CacheEntry<MunicipalityHit[]>>();

function fresh<T>(entry: CacheEntry<T> | undefined): T | null {
  if (!entry) return null;
  return Date.now() - entry.at < TTL_MS ? entry.data : null;
}

async function nominatimByPostalCode(cp: string): Promise<MunicipalityHit[]> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("postalcode", cp);
    url.searchParams.set("country", "Spain");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "10");
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "AguaCRM/1.0 (postal-code-lookup)",
        "Accept-Language": "es",
      },
      // Cache HTTP del runtime (Next): 1h
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const arr = (await res.json()) as Array<{
      address?: {
        municipality?: string;
        city?: string;
        town?: string;
        village?: string;
        province?: string;
        state?: string;
        postcode?: string;
      };
    }>;
    const seen = new Set<string>();
    const out: MunicipalityHit[] = [];
    for (const r of arr) {
      const a = r.address ?? {};
      const muni = a.municipality ?? a.city ?? a.town ?? a.village ?? null;
      if (!muni) continue;
      const province = a.province ?? a.state ?? "";
      const postal_code = a.postcode ?? cp;
      const key = `${muni}|${province}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ municipality: muni, province, postal_code });
    }
    return out;
  } catch {
    return [];
  }
}

async function nominatimByMunicipality(
  name: string,
  provinceHint?: string,
): Promise<MunicipalityHit[]> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    const query = provinceHint ? `${name}, ${provinceHint}, España` : `${name}, España`;
    url.searchParams.set("q", query);
    url.searchParams.set("countrycodes", "es");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "5");
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "AguaCRM/1.0 (municipality-lookup)",
        "Accept-Language": "es",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const arr = (await res.json()) as Array<{
      address?: {
        municipality?: string;
        city?: string;
        town?: string;
        village?: string;
        province?: string;
        state?: string;
        postcode?: string;
      };
    }>;
    const seen = new Set<string>();
    const out: MunicipalityHit[] = [];
    for (const r of arr) {
      const a = r.address ?? {};
      const muni = a.municipality ?? a.city ?? a.town ?? a.village ?? null;
      const postal_code = a.postcode ?? "";
      if (!muni || !postal_code) continue;
      const province = a.province ?? a.state ?? "";
      const key = `${postal_code}|${muni}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ municipality: muni, province, postal_code });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Devuelve municipios candidatos para un CP dado.
 * Primero busca en la tabla local; si vacío, cae a Nominatim.
 */
export async function lookupMunicipalitiesByPostalCode(
  cp: string,
): Promise<MunicipalityHit[]> {
  const code = cp.trim();
  if (!/^\d{5}$/.test(code)) return [];
  const cached = fresh(cpCache.get(code));
  if (cached) return cached;

  // 1) Tabla local
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data } = await supabase
      .from("postal_code_municipalities")
      .select("postal_code, municipality, province")
      .eq("postal_code", code)
      .order("municipality");
    const rows = (data ?? []) as MunicipalityHit[];
    if (rows.length > 0) {
      cpCache.set(code, { at: Date.now(), data: rows });
      return rows;
    }
  } catch {
    /* tabla puede no existir aún en algunas instalaciones — fallback */
  }

  // 2) Fallback Nominatim
  const fb = await nominatimByPostalCode(code);
  cpCache.set(code, { at: Date.now(), data: fb });
  return fb;
}

/**
 * Devuelve CPs candidatos para un nombre de municipio.
 * Primero busca en la tabla local; si vacío, cae a Nominatim.
 */
export async function lookupPostalCodesByMunicipality(
  name: string,
  provinceHint?: string,
): Promise<MunicipalityHit[]> {
  const muni = name.trim();
  if (muni.length < 2) return [];
  const key = `${muni.toLowerCase()}|${(provinceHint ?? "").toLowerCase()}`;
  const cached = fresh(muniCache.get(key));
  if (cached) return cached;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    let q = supabase
      .from("postal_code_municipalities")
      .select("postal_code, municipality, province")
      .ilike("municipality", muni)
      .order("postal_code");
    if (provinceHint) q = q.ilike("province", provinceHint);
    const { data } = await q;
    const rows = (data ?? []) as MunicipalityHit[];
    if (rows.length > 0) {
      muniCache.set(key, { at: Date.now(), data: rows });
      return rows;
    }
  } catch {
    /* fallback */
  }

  const fb = await nominatimByMunicipality(muni, provinceHint);
  muniCache.set(key, { at: Date.now(), data: fb });
  return fb;
}
