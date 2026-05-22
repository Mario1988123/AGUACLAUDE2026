"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { getMyDayItems } from "@/modules/my-day/actions";
import { nearestNeighborRoute, totalDistanceKm, type RoutePoint } from "./haversine";

export interface DayRouteItem {
  id: string;
  kind: "installation" | "maintenance" | "agenda";
  title: string;
  scheduled_at: string;
  lat: number;
  lng: number;
}

export interface DayRoutePlan {
  /** Punto de partida usado (lat/lng) */
  start: { lat: number; lng: number; label: string };
  /** Items con coordenadas, en orden cronológico actual */
  current: DayRouteItem[];
  /** Items reordenados por proximidad */
  optimized: DayRouteItem[];
  /** Km totales del orden actual */
  currentKm: number;
  /** Km totales del orden optimizado */
  optimizedKm: number;
  /** Items sin coordenadas, no entran en el cálculo */
  withoutGeo: Array<{ id: string; kind: string; title: string; scheduled_at: string }>;
}

/**
 * Calcula una propuesta de ruta optimizada para los items de "Mi día" del
 * usuario actual. Usa Haversine + nearest-neighbor; sin APIs externas.
 *
 * Punto de partida: si el user_profile tiene lat/lng, parte de allí. Si no,
 * usa la primera parada del día como inicio.
 */
export async function planMyDayRoute(): Promise<DayRoutePlan> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Resolver geo del técnico (si existe)
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("home_latitude, home_longitude")
    .eq("user_id", session.user_id)
    .maybeSingle();

  const items = await getMyDayItems();
  const withGeo: DayRouteItem[] = [];
  const withoutGeo: DayRoutePlan["withoutGeo"] = [];
  for (const it of items) {
    if (it.geo_latitude != null && it.geo_longitude != null) {
      withGeo.push({
        id: it.id,
        kind: it.kind,
        title: it.title,
        scheduled_at: it.scheduled_at,
        lat: it.geo_latitude,
        lng: it.geo_longitude,
      });
    } else {
      withoutGeo.push({
        id: it.id,
        kind: it.kind,
        title: it.title,
        scheduled_at: it.scheduled_at,
      });
    }
  }

  // Sin paradas con geo: devolver vacío
  if (withGeo.length === 0) {
    return {
      start: { lat: 0, lng: 0, label: "Sin punto de partida" },
      current: [],
      optimized: [],
      currentKm: 0,
      optimizedKm: 0,
      withoutGeo,
    };
  }

  const homeLat = (profile as { home_latitude: number | null } | null)?.home_latitude ?? null;
  const homeLng = (profile as { home_longitude: number | null } | null)?.home_longitude ?? null;
  const start =
    homeLat != null && homeLng != null
      ? { lat: homeLat, lng: homeLng, label: "Tu base" }
      : { lat: withGeo[0]!.lat, lng: withGeo[0]!.lng, label: "Primera parada del día" };

  const points: RoutePoint[] = withGeo.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }));
  const { ordered, totalKm: optimizedKm } = nearestNeighborRoute(start, points);
  const currentKm = totalDistanceKm(start, points);

  const byId = new Map(withGeo.map((p) => [p.id, p]));
  const optimized = ordered
    .map((o) => byId.get(o.id))
    .filter((v): v is DayRouteItem => !!v);

  return {
    start,
    current: withGeo,
    optimized,
    currentKm,
    optimizedKm,
    withoutGeo,
  };
}

/**
 * Aplica el orden propuesto reescribiendo los `scheduled_at` de los items.
 * Conserva la hora de inicio del día (la más temprana) y espacia los siguientes
 * cada `spacingMinutes` minutos. Sólo afecta a instalaciones y mantenimientos
 * propios del técnico.
 */
export async function applyMyDayRouteAction(
  orderedIds: string[],
  spacingMinutes: number = 60,
): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const items = await getMyDayItems();
  const byId = new Map(items.map((it) => [it.id, it]));

  // La primera parada conserva su hora; las demás se espacian
  const firstId = orderedIds[0];
  const first = firstId ? byId.get(firstId) : null;
  if (!first) return;
  const baseDate = new Date(first.scheduled_at);

  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    const it = byId.get(id);
    if (!it) continue;
    const newDate = new Date(baseDate.getTime() + i * spacingMinutes * 60 * 1000);
    const newIso = newDate.toISOString();
    if (it.kind === "installation") {
      await supabase
        .from("installations")
        .update({ scheduled_at: newIso })
        .eq("id", id)
        .eq("installer_user_id", session.user_id);
    } else if (it.kind === "maintenance") {
      await supabase
        .from("maintenance_jobs")
        .update({ scheduled_at: newIso })
        .eq("id", id)
        .eq("technician_user_id", session.user_id);
    } else if (it.kind === "agenda") {
      await supabase
        .from("agenda_events")
        .update({ starts_at: newIso })
        .eq("id", id)
        .eq("assigned_user_id", session.user_id);
    }
  }
  revalidatePath("/mi-dia");
  revalidatePath("/agenda");
}

// =================== Safe wrappers ===================

export async function planMyDayRouteSafeAction(): Promise<
  { ok: true; plan: DayRoutePlan } | { ok: false; error: string }
> {
  try {
    const plan = await planMyDayRoute();
    return { ok: true, plan };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function applyMyDayRouteSafeAction(
  orderedIds: string[],
  spacingMinutes: number = 60,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await applyMyDayRouteAction(orderedIds, spacingMinutes);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
