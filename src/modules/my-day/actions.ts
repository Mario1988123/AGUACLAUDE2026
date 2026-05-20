"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * "Mi día": agrega instalaciones, mantenimientos y eventos agenda asignados al
 * usuario actual con scheduled_at hoy. Útil para técnicos/comerciales en
 * tablet/móvil — una sola pantalla con todo lo del día.
 */

export interface DayItem {
  id: string;
  kind: "installation" | "maintenance" | "agenda";
  title: string;
  subtitle: string | null;
  scheduled_at: string;
  status: string;
  href: string;
  geo_latitude?: number | null;
  geo_longitude?: number | null;
  /** Para botones rápidos llamar/whatsapp en /mi-dia (técnico). */
  customer_phone?: string | null;
  /** Calle + número + ciudad para que el técnico vea destino directamente. */
  address_summary?: string | null;
}

function startOfToday(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  return { from, to };
}

export async function getMyDayItems(): Promise<DayItem[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { from, to } = startOfToday();

  const [instRes, maintRes, agendaRes] = await Promise.all([
    supabase
      .from("installations")
      .select("id, reference_code, customer_id, status, scheduled_at, address_id")
      .eq("installer_user_id", session.user_id)
      .in("status", ["scheduled", "in_progress", "paused"])
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", from)
      .lte("scheduled_at", to)
      .is("deleted_at", null),
    supabase
      .from("maintenance_jobs")
      .select("id, customer_id, status, scheduled_at")
      .eq("technician_user_id", session.user_id)
      .in("status", ["scheduled", "in_progress"])
      .gte("scheduled_at", from)
      .lte("scheduled_at", to),
    supabase
      .from("agenda_events")
      .select(
        "id, kind, status, title, description, starts_at, geo_latitude, geo_longitude, subject_type, subject_id",
      )
      .eq("assigned_user_id", session.user_id)
      .in("status", ["scheduled", "in_progress"])
      .gte("starts_at", from)
      .lte("starts_at", to)
      .is("deleted_at", null),
  ]);

  type Inst = {
    id: string;
    reference_code: string | null;
    customer_id: string;
    status: string;
    scheduled_at: string;
    address_id: string | null;
  };
  type Maint = {
    id: string;
    customer_id: string;
    status: string;
    scheduled_at: string;
  };
  type Ag = {
    id: string;
    kind: string;
    status: string;
    title: string;
    description: string | null;
    starts_at: string;
    geo_latitude: number | null;
    geo_longitude: number | null;
    subject_type: string | null;
    subject_id: string | null;
  };
  const insts = (instRes.data ?? []) as Inst[];
  const maints = (maintRes.data ?? []) as Maint[];
  const agendas = (agendaRes.data ?? []) as Ag[];

  // Resolver nombres + teléfono de cliente
  const cIds = Array.from(
    new Set([...insts.map((i) => i.customer_id), ...maints.map((m) => m.customer_id)].filter(Boolean)),
  );
  const nameMap = new Map<string, string>();
  const phoneMap = new Map<string, string>();
  if (cIds.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary")
      .in("id", cIds);
    type CC = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone_primary: string | null;
    };
    for (const c of (cs ?? []) as CC[]) {
      const n =
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "—"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";
      nameMap.set(c.id, n);
      if (c.phone_primary) phoneMap.set(c.id, c.phone_primary);
    }
  }

  const items: DayItem[] = [];

  // Resolver geo + dirección de instalaciones
  const addrIds = insts.map((i) => i.address_id).filter((v): v is string => !!v);
  const addrGeoMap = new Map<
    string,
    { lat: number | null; lng: number | null; summary: string | null }
  >();
  if (addrIds.length > 0) {
    const { data: addrs } = await supabase
      .from("addresses")
      .select("id, latitude, longitude, street_type, street, street_number, postal_code, city")
      .in("id", addrIds);
    for (const a of (addrs ?? []) as Array<{
      id: string;
      latitude: number | null;
      longitude: number | null;
      street_type: string | null;
      street: string | null;
      street_number: string | null;
      postal_code: string | null;
      city: string | null;
    }>) {
      const summary = [
        a.street_type,
        a.street,
        a.street_number,
        a.postal_code,
        a.city,
      ]
        .filter(Boolean)
        .join(" ");
      addrGeoMap.set(a.id, {
        lat: a.latitude,
        lng: a.longitude,
        summary: summary || null,
      });
    }
  }

  for (const i of insts) {
    const geo = i.address_id ? addrGeoMap.get(i.address_id) : null;
    items.push({
      id: i.id,
      kind: "installation",
      title: nameMap.get(i.customer_id) ?? "Cliente",
      subtitle: i.reference_code ?? `#${i.id.slice(0, 8)}`,
      scheduled_at: i.scheduled_at,
      status: i.status,
      href: `/instalaciones/${i.id}`,
      geo_latitude: geo?.lat ?? null,
      geo_longitude: geo?.lng ?? null,
      customer_phone: phoneMap.get(i.customer_id) ?? null,
      address_summary: geo?.summary ?? null,
    });
  }
  for (const m of maints) {
    items.push({
      id: m.id,
      kind: "maintenance",
      title: nameMap.get(m.customer_id) ?? "Cliente",
      subtitle: "Mantenimiento",
      scheduled_at: m.scheduled_at,
      status: m.status,
      href: `/mantenimientos/${m.id}`,
      customer_phone: phoneMap.get(m.customer_id) ?? null,
    });
  }
  for (const a of agendas) {
    items.push({
      id: a.id,
      kind: "agenda",
      title: a.title,
      subtitle: a.description,
      scheduled_at: a.starts_at,
      status: a.status,
      href: a.subject_type === "lead"
        ? `/leads/${a.subject_id}`
        : a.subject_type === "customer"
          ? `/clientes/${a.subject_id}`
          : "/agenda",
      geo_latitude: a.geo_latitude,
      geo_longitude: a.geo_longitude,
    });
  }

  return items.sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at));
}

/**
 * Distancia Haversine en km entre dos puntos.
 */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Devuelve los items de mi-día ordenados por ruta óptima desde el
 * punto de partida (casa del usuario). TSP greedy: arrancando en home,
 * siguiente parada = la más cercana no visitada.
 *
 * Si el usuario no tiene home_latitude/longitude, devuelve null y el
 * caller cae a orden cronológico.
 */
export async function getMyDayItemsOptimized(): Promise<{
  items: DayItem[];
  total_km: number;
  ordered: boolean;
} | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: prof } = await supabase
    .from("user_profiles")
    .select("home_latitude, home_longitude")
    .eq("user_id", session.user_id)
    .maybeSingle();
  const home = prof as
    | { home_latitude: number | null; home_longitude: number | null }
    | null;
  if (!home?.home_latitude || !home?.home_longitude) {
    // Sin home configurada, devolvemos sin orden geográfico
    const items = await getMyDayItems();
    return { items, total_km: 0, ordered: false };
  }

  const all = await getMyDayItems();
  // Separar items CON coords vs SIN coords
  const withCoords = all.filter(
    (i) => i.geo_latitude != null && i.geo_longitude != null,
  );
  const without = all.filter(
    (i) => i.geo_latitude == null || i.geo_longitude == null,
  );

  // TSP greedy: empezar en home, ir a la más cercana cada vez
  const ordered: DayItem[] = [];
  let curLat = home.home_latitude;
  let curLng = home.home_longitude;
  const remaining = [...withCoords];
  let totalKm = 0;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestKm = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const it = remaining[i]!;
      const km = haversineKm(curLat, curLng, it.geo_latitude!, it.geo_longitude!);
      if (km < bestKm) {
        bestKm = km;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    totalKm += bestKm;
    curLat = next.geo_latitude!;
    curLng = next.geo_longitude!;
    ordered.push(next);
  }
  // Los sin coords van al final, en orden cronológico
  const result = [...ordered, ...without];
  return { items: result, total_km: Math.round(totalKm * 10) / 10, ordered: true };
}
