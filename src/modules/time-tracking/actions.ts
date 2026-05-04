"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

export interface PunchRow {
  id: string;
  user_id: string;
  punch_kind: PunchKind;
  punched_at: string;
  geo_latitude: number | null;
  geo_longitude: number | null;
  needs_geo_review: boolean;
  is_manual: boolean;
  manual_reason: string | null;
  auto_closed: boolean;
  edited_by_admin: string | null;
  edited_reason: string | null;
}

interface PunchInput {
  geo_latitude: number | null;
  geo_longitude: number | null;
  accuracy_meters: number | null;
}

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

/**
 * Inserta un fichaje del usuario actual. Si no hay geo, marca needs_geo_review
 * + crea incidencia. El kind se infiere automáticamente: si el último fichaje
 * de hoy es clock_in, el siguiente es clock_out, y viceversa.
 */
export async function punchAction(input: PunchInput): Promise<{ kind: PunchKind }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Determinar kind
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: lastToday } = await admin
    .from("time_punches")
    .select("punch_kind")
    .eq("user_id", session.user_id)
    .gte("punched_at", todayStart.toISOString())
    .order("punched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = (lastToday as { punch_kind: PunchKind } | null)?.punch_kind ?? null;
  const kind: PunchKind = last === "clock_in" ? "clock_out" : "clock_in";

  const noGeo = input.geo_latitude == null || input.geo_longitude == null;

  await admin.from("time_punches").insert({
    company_id: session.company_id,
    user_id: session.user_id,
    punch_kind: kind,
    punched_at: new Date().toISOString(),
    geo_latitude: input.geo_latitude,
    geo_longitude: input.geo_longitude,
    accuracy_meters: input.accuracy_meters,
    needs_geo_review: noGeo,
    is_manual: false,
  });

  // Si no aceptó geo → crear incidencia (lo ven los admin)
  if (noGeo) {
    try {
      await admin.from("incidents").insert({
        company_id: session.company_id,
        title: `Fichaje sin geolocalización (${kind})`,
        description: `${session.full_name ?? session.email ?? session.user_id} ha fichado sin permitir geolocalización.`,
        origin: "other",
        priority: "medium",
        status: "open",
        created_by: session.user_id,
      });
    } catch {
      /* fail-soft */
    }
  }

  revalidatePath("/fichajes");
  revalidatePath("/", "layout");
  return { kind };
}

export interface DayPunch {
  id: string;
  kind: PunchKind;
  at: string;
  needs_geo_review: boolean;
  auto_closed: boolean;
  edited_reason: string | null;
}

/**
 * Devuelve los fichajes del usuario actual para un día concreto, ordenados
 * cronológicamente.
 */
export async function getMyPunchesForDay(date: string): Promise<DayPunch[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const start = new Date(date + "T00:00:00").toISOString();
  const end = new Date(date + "T23:59:59.999").toISOString();
  const { data } = await admin
    .from("time_punches")
    .select("id, punch_kind, punched_at, needs_geo_review, auto_closed, edited_reason")
    .eq("user_id", session.user_id)
    .gte("punched_at", start)
    .lte("punched_at", end)
    .order("punched_at", { ascending: true });
  type R = {
    id: string;
    punch_kind: PunchKind;
    punched_at: string;
    needs_geo_review: boolean;
    auto_closed: boolean;
    edited_reason: string | null;
  };
  return ((data ?? []) as R[]).map((r) => ({
    id: r.id,
    kind: r.punch_kind,
    at: r.punched_at,
    needs_geo_review: r.needs_geo_review,
    auto_closed: r.auto_closed,
    edited_reason: r.edited_reason,
  }));
}

export interface ClockExtended {
  status: "working" | "stopped" | "on_break";
  since?: string;
  shift?: { starts_at: string; ends_at: string } | null;
  canPunch: boolean;
  reason?: string;
}

/**
 * Estado extendido + horario del día + si puede fichar (30min antes del
 * turno y hasta 2h después del fin).
 */
export async function getMyClockExtended(): Promise<ClockExtended> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { status: "stopped", canPunch: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: punches } = await admin
      .from("time_punches")
      .select("punch_kind, punched_at")
      .eq("user_id", session.user_id)
      .gte("punched_at", todayStart.toISOString())
      .order("punched_at", { ascending: false })
      .limit(20);
    type P = { punch_kind: PunchKind; punched_at: string };
    const list = (punches ?? []) as P[];
    const last = list[0] ?? null;
    let status: ClockExtended["status"] = "stopped";
    let since: string | undefined;
    if (last) {
      if (last.punch_kind === "clock_in" || last.punch_kind === "break_end") {
        status = "working";
        const firstIn = [...list].reverse().find((p) => p.punch_kind === "clock_in");
        since = firstIn?.punched_at;
      } else if (last.punch_kind === "break_start") {
        status = "on_break";
        since = last.punched_at;
      }
    }

    const dow = (new Date().getDay() + 6) % 7;
    const { data: sched } = await admin
      .from("user_work_schedules")
      .select("starts_at, ends_at")
      .eq("user_id", session.user_id)
      .eq("day_of_week", dow)
      .maybeSingle();
    const s = sched as { starts_at: string | null; ends_at: string | null } | null;
    const shift =
      s && s.starts_at && s.ends_at ? { starts_at: s.starts_at, ends_at: s.ends_at } : null;

    let canPunch = true;
    let reason: string | undefined;
    if (shift) {
      const now = new Date();
      const [sh, sm] = shift.starts_at.split(":").map(Number);
      const [eh, em] = shift.ends_at.split(":").map(Number);
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh!, sm!, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh!, em!, 0);
      const earliestPunch = new Date(start.getTime() - 30 * 60 * 1000);
      const latestPunch = new Date(end.getTime() + 2 * 3600 * 1000);
      if (now < earliestPunch) {
        canPunch = false;
        reason = `Tu turno empieza a las ${shift.starts_at} (puedes fichar desde 30 min antes).`;
      } else if (now > latestPunch && status === "stopped") {
        canPunch = false;
        reason = "Tu turno terminó hace más de 2 horas.";
      }
    }
    return { status, since, shift, canPunch, reason };
  } catch {
    return { status: "stopped", canPunch: false };
  }
}

/**
 * Inserta un fichaje específico (clock_in/out, break_start/end) y devuelve
 * el estado actualizado para que el widget refleje el cambio inmediatamente
 * sin necesidad de un round-trip extra a getMyClockExtended.
 */
export async function punchKindAction(
  kind: PunchKind,
  input: {
    geo_latitude: number | null;
    geo_longitude: number | null;
    accuracy_meters: number | null;
  },
): Promise<ClockExtended> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const noGeo = input.geo_latitude == null || input.geo_longitude == null;
  const { error: insertError } = await admin.from("time_punches").insert({
    company_id: session.company_id,
    user_id: session.user_id,
    punch_kind: kind,
    punched_at: new Date().toISOString(),
    geo_latitude: input.geo_latitude,
    geo_longitude: input.geo_longitude,
    accuracy_meters: input.accuracy_meters,
    needs_geo_review: noGeo,
    is_manual: false,
  });
  if (insertError) throw new Error(insertError.message);

  if (noGeo) {
    try {
      await admin.from("incidents").insert({
        company_id: session.company_id,
        title: `Fichaje sin geolocalización (${kind})`,
        description: `${session.full_name ?? session.email ?? session.user_id} ha fichado sin permitir geolocalización.`,
        origin: "other",
        priority: "medium",
        status: "open",
        created_by: session.user_id,
      });
    } catch {
      /* no-op */
    }
  }
  revalidatePath("/fichajes");
  // Devolver estado fresco directamente
  return await getMyClockExtended();
}

/** Estado actual del usuario: ¿tiene un clock_in abierto hoy? */
export async function getMyCurrentStatus(): Promise<{
  status: "working" | "stopped";
  since?: string;
}> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { status: "stopped" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data } = await admin
      .from("time_punches")
      .select("punch_kind, punched_at")
      .eq("user_id", session.user_id)
      .gte("punched_at", todayStart.toISOString())
      .order("punched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = data as { punch_kind: PunchKind; punched_at: string } | null;
    if (last && last.punch_kind === "clock_in") {
      return { status: "working", since: last.punched_at };
    }
    return { status: "stopped" };
  } catch {
    return { status: "stopped" };
  }
}

export interface AdminPunchRow extends PunchRow {
  user_name: string | null;
}

/**
 * Listado completo (admin) o por dpto (director) de fichajes en un rango.
 */
export async function listPunchesAdmin(filters: {
  from: string;
  to: string;
  user_id?: string;
}): Promise<AdminPunchRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isAdmin) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("time_punches")
    .select(
      "id, user_id, punch_kind, punched_at, geo_latitude, geo_longitude, needs_geo_review, is_manual, manual_reason, auto_closed, edited_by_admin, edited_reason",
    )
    .eq("company_id", session.company_id)
    .gte("punched_at", filters.from)
    .lte("punched_at", filters.to)
    .order("punched_at", { ascending: false })
    .limit(2000);
  if (filters.user_id) q = q.eq("user_id", filters.user_id);
  const { data } = await q;
  type R = PunchRow;
  const rows = (data ?? []) as R[];
  // Resolver nombres
  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const nameMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", ids);
    for (const p of (profs ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }
  return rows.map((r) => ({ ...r, user_name: nameMap.get(r.user_id) ?? null }));
}

/** Editar fichaje (solo admin), deja huella de quién y por qué. */
export async function editPunchAction(
  punchId: string,
  newPunchedAt: string,
  reason: string,
): Promise<void> {
  const session = await ensureAdmin();
  if (!reason || reason.trim().length < 3) throw new Error("Motivo obligatorio");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("time_punches")
    .update({
      punched_at: newPunchedAt,
      is_manual: true,
      edited_by_admin: session.user_id,
      edited_reason: reason,
    })
    .eq("id", punchId)
    .eq("company_id", session.company_id);
  revalidatePath("/fichajes");
}

/** Cierra los fichajes abiertos +2h tras fin de jornada. Llama al RPC. */
export async function autoCloseStalePunchesAction(): Promise<{ closed: number }> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin.rpc("autoclose_stale_punches");
  return { closed: Number(data) || 0 };
}

/** Listado de usuarios sin fichar hoy (para notificaciones). */
export async function getUsersWithoutPunchTodayAction(): Promise<
  Array<{ user_id: string; full_name: string }>
> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dow = (new Date().getDay() + 6) % 7; // lunes=0

  // Usuarios con horario hoy
  const { data: scheds } = await admin
    .from("user_work_schedules")
    .select("user_id")
    .eq("company_id", session.company_id)
    .eq("day_of_week", dow)
    .not("starts_at", "is", null);
  const expected = Array.from(
    new Set(((scheds ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  );
  if (expected.length === 0) return [];

  const { data: punched } = await admin
    .from("time_punches")
    .select("user_id")
    .eq("company_id", session.company_id)
    .gte("punched_at", todayStart.toISOString())
    .in("user_id", expected);
  const punchedSet = new Set(((punched ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));

  const missing = expected.filter((u) => !punchedSet.has(u));
  if (missing.length === 0) return [];
  const { data: profs } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in("user_id", missing);
  return ((profs ?? []) as Array<{ user_id: string; full_name: string | null }>).map((p) => ({
    user_id: p.user_id,
    full_name: p.full_name ?? p.user_id.slice(0, 8),
  }));
}
