"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { nearestNeighborRoute, totalDistanceKm, type RoutePoint } from "./haversine";
import { optimizeRouteWithGoogle } from "@/shared/lib/google-maps/routes";
import type { DayRoutePlan, DayRouteItem } from "./actions";

interface TeamMember {
  user_id: string;
  full_name: string | null;
  role_key: string;
  home_latitude: number | null;
  home_longitude: number | null;
}

export interface TeamMemberRoute {
  member: TeamMember;
  plan: DayRoutePlan;
}

/**
 * Devuelve los miembros del equipo del usuario actual. Director técnico
 * ve a sus instaladores; director comercial ve a sus comerciales/TMK;
 * admin ve a todos.
 *
 * El scope se basa en team_assignments (regla del CRM): solo los
 * usuarios cuyo team_lead_user_id apunta al líder, más el propio líder.
 * Superadmin/admin ve todos los de la empresa.
 */
async function getTeamMemberIds(): Promise<{
  member_ids: string[];
  is_leader: boolean;
}> {
  const session = await requireSession();
  if (!session.company_id) return { member_ids: [], is_leader: false };
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin");
  const isTechDir = session.roles.includes("technical_director");
  const isCommDir =
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isAdmin && !isTechDir && !isCommDir) {
    return { member_ids: [], is_leader: false };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  if (isAdmin) {
    const { data } = await admin
      .from("user_profiles")
      .select("user_id")
      .eq("company_id", session.company_id);
    const ids = ((data ?? []) as Array<{ user_id: string }>).map(
      (r) => r.user_id,
    );
    return { member_ids: ids, is_leader: true };
  }
  // Directores: solo los asignados a su equipo.
  // OJO: la tabla team_assignments usa manager_user_id / member_user_id
  // (migración 20260501120200), NO team_lead_user_id / user_id. Con los
  // nombres viejos la query fallaba → catch → el director solo se veía a sí
  // mismo. Mismo patrón que agenda/actions.ts.
  try {
    const { data } = await admin
      .from("team_assignments")
      .select("member_user_id")
      .eq("company_id", session.company_id)
      .eq("manager_user_id", session.user_id)
      .is("revoked_at", null);
    const ids = ((data ?? []) as Array<{ member_user_id: string }>).map(
      (r) => r.member_user_id,
    );
    // El propio líder también entra en el plan
    if (!ids.includes(session.user_id)) ids.push(session.user_id);
    return { member_ids: ids, is_leader: true };
  } catch {
    return { member_ids: [session.user_id], is_leader: true };
  }
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { member_ids } = await getTeamMemberIds();
  if (member_ids.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: profs } = await admin
    .from("user_profiles")
    .select("user_id, full_name, home_latitude, home_longitude")
    .in("user_id", member_ids);
  const { data: roles } = await admin
    .from("user_roles")
    .select("user_id, role_key")
    .in("user_id", member_ids)
    .is("revoked_at", null);

  type PR = {
    user_id: string;
    full_name: string | null;
    home_latitude: number | null;
    home_longitude: number | null;
  };
  type RR = { user_id: string; role_key: string };

  const profilesById = new Map<string, PR>();
  for (const p of (profs ?? []) as PR[]) profilesById.set(p.user_id, p);
  const roleById = new Map<string, string>();
  for (const r of (roles ?? []) as RR[]) {
    if (!roleById.has(r.user_id)) roleById.set(r.user_id, r.role_key);
  }

  const result: TeamMember[] = [];
  for (const id of member_ids) {
    const p = profilesById.get(id);
    if (!p) continue;
    // Solo nos interesan roles "campo" (instalador, comercial, tmk)
    const role = roleById.get(id) ?? "unknown";
    if (
      ![
        "installer",
        "sales_rep",
        "telemarketer",
        "technical_director",
        "commercial_director",
        "telemarketing_director",
      ].includes(role)
    ) {
      continue;
    }
    result.push({
      user_id: id,
      full_name: p.full_name,
      role_key: role,
      home_latitude: p.home_latitude,
      home_longitude: p.home_longitude,
    });
  }
  return result.sort((a, b) =>
    (a.full_name ?? "").localeCompare(b.full_name ?? ""),
  );
}

interface RawTask {
  id: string;
  kind: "installation" | "maintenance" | "agenda";
  title: string;
  scheduled_at: string;
  lat: number;
  lng: number;
}

async function getTasksForUser(userId: string, dateIso: string): Promise<{
  withGeo: RawTask[];
  withoutGeo: DayRoutePlan["withoutGeo"];
}> {
  const session = await requireSession();
  if (!session.company_id) return { withGeo: [], withoutGeo: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const d = new Date(dateIso);
  const from = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    0,
    0,
    0,
  ).toISOString();
  const to = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    23,
    59,
    59,
  ).toISOString();

  // 1) installations + address coords
  const { data: insts } = await admin
    .from("installations")
    .select(
      "id, reference_code, scheduled_at, customer_id, address_id, status",
    )
    .eq("company_id", session.company_id)
    .eq("installer_user_id", userId)
    .in("status", ["scheduled", "in_progress", "paused"])
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .is("deleted_at", null);

  type IR = {
    id: string;
    reference_code: string | null;
    scheduled_at: string;
    customer_id: string | null;
    address_id: string | null;
  };
  const installRows = (insts ?? []) as IR[];
  const addrIds = installRows
    .map((r) => r.address_id)
    .filter((v): v is string => !!v);
  const addrCoords = new Map<string, { lat: number; lng: number }>();
  if (addrIds.length > 0) {
    const { data: addrs } = await admin
      .from("addresses")
      .select("id, latitude, longitude")
      .in("id", addrIds);
    for (const a of (addrs ?? []) as Array<{
      id: string;
      latitude: number | null;
      longitude: number | null;
    }>) {
      if (a.latitude != null && a.longitude != null) {
        addrCoords.set(a.id, {
          lat: Number(a.latitude),
          lng: Number(a.longitude),
        });
      }
    }
  }

  // 2) maintenance_jobs
  const { data: maints } = await admin
    .from("maintenance_jobs")
    .select("id, scheduled_at, customer_id, address_id, status")
    .eq("company_id", session.company_id)
    .eq("technician_user_id", userId)
    .in("status", ["scheduled", "in_progress"])
    .gte("scheduled_at", from)
    .lte("scheduled_at", to);
  type MR = {
    id: string;
    scheduled_at: string;
    customer_id: string | null;
    address_id: string | null;
  };
  const maintRows = (maints ?? []) as MR[];
  const maintAddrIds = maintRows
    .map((r) => r.address_id)
    .filter((v): v is string => !!v);
  if (maintAddrIds.length > 0) {
    const { data: addrs } = await admin
      .from("addresses")
      .select("id, latitude, longitude")
      .in("id", maintAddrIds);
    for (const a of (addrs ?? []) as Array<{
      id: string;
      latitude: number | null;
      longitude: number | null;
    }>) {
      if (a.latitude != null && a.longitude != null) {
        addrCoords.set(a.id, {
          lat: Number(a.latitude),
          lng: Number(a.longitude),
        });
      }
    }
  }

  // 3) agenda_events
  const { data: agenda } = await admin
    .from("agenda_events")
    .select(
      // agenda_events NO tiene customer_id (usa subject_type/subject_id). Antes
      // el SELECT fallaba y la vista equipo ocultaba TODOS los eventos de agenda.
      "id, title, starts_at, geo_latitude, geo_longitude, status",
    )
    .eq("company_id", session.company_id)
    .eq("assigned_user_id", userId)
    .gte("starts_at", from)
    .lte("starts_at", to)
    .neq("status", "cancelled");
  type AR = {
    id: string;
    title: string;
    starts_at: string;
    geo_latitude: number | null;
    geo_longitude: number | null;
    status: string;
  };
  const agendaRows = (agenda ?? []) as AR[];

  const withGeo: RawTask[] = [];
  const withoutGeo: DayRoutePlan["withoutGeo"] = [];

  for (const r of installRows) {
    const c = r.address_id ? addrCoords.get(r.address_id) : undefined;
    if (c) {
      withGeo.push({
        id: r.id,
        kind: "installation",
        title: r.reference_code ?? `Instalación ${r.id.slice(0, 8)}`,
        scheduled_at: r.scheduled_at,
        lat: c.lat,
        lng: c.lng,
      });
    } else {
      withoutGeo.push({
        id: r.id,
        kind: "installation",
        title: r.reference_code ?? "Instalación",
        scheduled_at: r.scheduled_at,
      });
    }
  }
  for (const r of maintRows) {
    const c = r.address_id ? addrCoords.get(r.address_id) : undefined;
    if (c) {
      withGeo.push({
        id: r.id,
        kind: "maintenance",
        title: `Mantenimiento ${r.id.slice(0, 8)}`,
        scheduled_at: r.scheduled_at,
        lat: c.lat,
        lng: c.lng,
      });
    } else {
      withoutGeo.push({
        id: r.id,
        kind: "maintenance",
        title: "Mantenimiento",
        scheduled_at: r.scheduled_at,
      });
    }
  }
  for (const r of agendaRows) {
    if (r.geo_latitude != null && r.geo_longitude != null) {
      withGeo.push({
        id: r.id,
        kind: "agenda",
        title: r.title,
        scheduled_at: r.starts_at,
        lat: Number(r.geo_latitude),
        lng: Number(r.geo_longitude),
      });
    } else {
      withoutGeo.push({
        id: r.id,
        kind: "agenda",
        title: r.title,
        scheduled_at: r.starts_at,
      });
    }
  }
  return { withGeo, withoutGeo };
}

async function planForUser(
  userId: string,
  dateIso: string,
  base: { lat: number; lng: number; label: string },
): Promise<DayRoutePlan> {
  const session = await requireSession();
  const { withGeo, withoutGeo } = await getTasksForUser(userId, dateIso);

  if (withGeo.length === 0) {
    return {
      start: base,
      current: [],
      optimized: [],
      currentKm: 0,
      optimizedKm: 0,
      withoutGeo,
    };
  }

  const points: RoutePoint[] = withGeo.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
  }));
  const currentKm = totalDistanceKm(base, points);

  let optimizedKm: number;
  let optimizedItems: DayRouteItem[];
  let googlePlan: Awaited<ReturnType<typeof optimizeRouteWithGoogle>> | null =
    null;
  if (session.company_id) {
    googlePlan = await optimizeRouteWithGoogle({
      companyId: session.company_id,
      userId: session.user_id,
      start: { lat: base.lat, lng: base.lng },
      waypoints: withGeo.map((p) => ({ lat: p.lat, lng: p.lng })),
    });
  }
  if (googlePlan) {
    optimizedKm = googlePlan.totalKm;
    optimizedItems = googlePlan.order
      .map((idx) => withGeo[idx])
      .filter((v): v is RawTask => !!v)
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        scheduled_at: p.scheduled_at,
        lat: p.lat,
        lng: p.lng,
      }));
  } else {
    const nn = nearestNeighborRoute(base, points);
    optimizedKm = nn.totalKm;
    const byId = new Map(withGeo.map((p) => [p.id, p]));
    optimizedItems = nn.ordered
      .map((o) => byId.get(o.id))
      .filter((v): v is RawTask => !!v)
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        scheduled_at: p.scheduled_at,
        lat: p.lat,
        lng: p.lng,
      }));
  }
  const current: DayRouteItem[] = withGeo.map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    scheduled_at: p.scheduled_at,
    lat: p.lat,
    lng: p.lng,
  }));
  return {
    start: base,
    current,
    optimized: optimizedItems,
    currentKm,
    optimizedKm,
    withoutGeo,
  };
}

/**
 * Genera planes de ruta para todos los miembros del equipo del líder
 * actual para la fecha indicada (default = hoy). Devuelve por miembro
 * el DayRoutePlan completo (current + optimized + km).
 */
export async function planTeamDayRoutes(args?: {
  date?: string;
}): Promise<TeamMemberRoute[]> {
  const members = await listTeamMembers();
  if (members.length === 0) return [];
  const date = args?.date ?? new Date().toISOString();

  const results: TeamMemberRoute[] = [];
  for (const m of members) {
    const base =
      m.home_latitude != null && m.home_longitude != null
        ? {
            lat: Number(m.home_latitude),
            lng: Number(m.home_longitude),
            label: "Base del técnico",
          }
        : { lat: 40.4168, lng: -3.7038, label: "Centro de España" };
    const plan = await planForUser(m.user_id, date, base);
    results.push({ member: m, plan });
  }
  return results;
}

/**
 * Aplica un orden propuesto reescribiendo los scheduled_at de un usuario
 * concreto. Permitido al líder (admin/director) sobre miembros de su
 * equipo. Si el usuario no es líder y orderedIds incluye items de otro
 * técnico, las updates fallarán silenciosamente por RLS.
 */
export async function applyTeamDayRouteSafeAction(input: {
  user_id: string;
  ordered_ids: string[];
  spacing_minutes?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isLeader =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director") ||
      session.roles.includes("commercial_director") ||
      session.roles.includes("telemarketing_director");
    if (!isLeader) return { ok: false, error: "Solo admin/director" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { withGeo } = await getTasksForUser(
      input.user_id,
      new Date().toISOString(),
    );
    const byId = new Map(withGeo.map((p) => [p.id, p]));
    const ordered = input.ordered_ids
      .map((id) => byId.get(id))
      .filter((v): v is RawTask => !!v);
    if (ordered.length === 0) return { ok: false, error: "Sin items en el orden" };

    const spacing = input.spacing_minutes ?? 60;
    const baseDate = new Date(ordered[0]!.scheduled_at);
    for (let i = 0; i < ordered.length; i++) {
      const it = ordered[i]!;
      const newIso = new Date(
        baseDate.getTime() + i * spacing * 60 * 1000,
      ).toISOString();
      if (it.kind === "installation") {
        await admin
          .from("installations")
          .update({ scheduled_at: newIso })
          .eq("id", it.id)
          .eq("installer_user_id", input.user_id);
      } else if (it.kind === "maintenance") {
        await admin
          .from("maintenance_jobs")
          .update({ scheduled_at: newIso })
          .eq("id", it.id)
          .eq("technician_user_id", input.user_id);
      } else if (it.kind === "agenda") {
        await admin
          .from("agenda_events")
          .update({ starts_at: newIso })
          .eq("id", it.id)
          .eq("assigned_user_id", input.user_id);
      }
    }
    revalidatePath("/rutas/equipo");
    revalidatePath("/mi-dia");
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
