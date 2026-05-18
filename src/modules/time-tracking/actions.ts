"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import type {
  PunchKind,
  DayPunch,
  ClockExtended,
  AdminPunchRow,
  PunchRow,
  PunchResult,
} from "./types";

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

/** Admin amplio: admin + directores (los que también ven la vista admin
 *  de fichajes y aprueban solicitudes). */
async function ensureAdminOrDirector() {
  const session = await requireSession();
  const ok =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!ok) throw new Error("Solo admin o director");
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

  // Si es entrada de jornada y hay loading_request asignada al técnico para
  // hoy, notificarle. Fail-soft (no bloquea el fichaje).
  if (kind === "clock_in") {
    try {
      const { data: lr } = await admin
        .from("loading_requests")
        .select("id, destination_warehouse_id, needed_for")
        .eq("company_id", session.company_id)
        .in("status", ["requested", "preparing", "prepared"])
        .lte("needed_for", new Date().toISOString().slice(0, 10))
        .order("needed_for", { ascending: true });
      const reqs = (lr ?? []) as Array<{
        id: string;
        destination_warehouse_id: string;
        needed_for: string | null;
      }>;
      if (reqs.length > 0) {
        const destIds = Array.from(new Set(reqs.map((r) => r.destination_warehouse_id)));
        const { data: vans } = await admin
          .from("warehouses")
          .select("id, assigned_user_id")
          .in("id", destIds);
        const myVan = ((vans ?? []) as Array<{
          id: string;
          assigned_user_id: string | null;
        }>).find((w) => w.assigned_user_id === session.user_id);
        if (myVan) {
          const myReqs = reqs.filter((r) => r.destination_warehouse_id === myVan.id);
          if (myReqs.length > 0) {
            await admin.from("notifications").insert({
              company_id: session.company_id,
              recipient_user_id: session.user_id,
              kind: "loading.pending",
              severity: "info",
              title: "Tienes carga pendiente",
              body: `${myReqs.length} orden(es) de carga lista(s) para tu furgoneta. Pasa por el almacén antes de salir.`,
              subject_type: "loading_request",
              subject_id: myReqs[0]!.id,
              action_url: `/almacenes/${myVan.id}`,
            });
          }
        }
      }
    } catch (e) {
      console.error("[punchAction] loading notif failed:", e);
    }
  }

  revalidatePath("/fichajes");
  revalidatePath("/", "layout");
  return { kind };
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

    // Horario hoy (defensivo: si la tabla no existe, sin shift)
    const dow = (new Date().getDay() + 6) % 7;
    let shift: { starts_at: string; ends_at: string } | null = null;
    try {
      const { data: sched, error: schedErr } = await admin
        .from("user_work_schedules")
        .select("starts_at, ends_at")
        .eq("user_id", session.user_id)
        .eq("day_of_week", dow)
        .maybeSingle();
      if (!schedErr) {
        const s = sched as { starts_at: string | null; ends_at: string | null } | null;
        if (s && s.starts_at && s.ends_at) {
          shift = { starts_at: s.starts_at, ends_at: s.ends_at };
        }
      }
    } catch {
      /* tabla no aplicada todavía */
    }

    // Reglas de turno: si hay turno y estás fuera de la ventana
    // (-30 min antes / +2h después), NO bloqueamos — solo dejamos
    // `reason` como aviso. El usuario puede fichar horas extra o llegar
    // antes; admin verá el fichaje fuera de turno en el listado.
    let canPunch = true;
    let reason: string | undefined;

    // Bloqueo por ausencia aprobada hoy: si el empleado está de
    // vacaciones, baja, etc. aprobadas y la fecha actual está dentro
    // del rango, NO puede fichar.
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: absentToday } = await admin
        .from("time_absences")
        .select("kind, starts_on, ends_on")
        .eq("user_id", session.user_id)
        .eq("status", "approved")
        .lte("starts_on", todayStr)
        .gte("ends_on", todayStr)
        .limit(1)
        .maybeSingle();
      const a = absentToday as
        | { kind: string; starts_on: string; ends_on: string }
        | null;
      if (a) {
        const KIND_LABEL_LC: Record<string, string> = {
          vacation: "vacaciones",
          sick: "baja médica",
          maternity: "maternidad",
          paternity: "paternidad",
          marriage: "permiso por matrimonio",
          bereavement: "permiso por fallecimiento",
          lactation: "lactancia",
          parental_paid_8y: "permiso parental retribuido",
          parental_unpaid_8y: "permiso parental no retribuido",
          mudanza: "mudanza",
          civic_duty: "deber público",
          personal: "asunto personal",
          training: "formación",
          other: "ausencia",
        };
        canPunch = false;
        reason = `Estás de ${KIND_LABEL_LC[a.kind] ?? "ausencia"} hoy (hasta ${new Date(a.ends_on).toLocaleDateString("es-ES")}). No puedes fichar.`;
      }
    } catch {
      /* fail-soft */
    }
    if (shift) {
      const now = new Date();
      const [sh, sm] = shift.starts_at.split(":").map(Number);
      const [eh, em] = shift.ends_at.split(":").map(Number);
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh!, sm!, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh!, em!, 0);
      const earliestPunch = new Date(start.getTime() - 30 * 60 * 1000);
      const latestPunch = new Date(end.getTime() + 2 * 3600 * 1000);
      if (now < earliestPunch) {
        reason = `Tu turno empieza a las ${shift.starts_at}.`;
      } else if (now > latestPunch && status === "stopped") {
        reason = "Tu turno terminó hace más de 2 horas.";
      }
    }
    return { status, since, shift, canPunch, reason };
  } catch {
    // Fail-open: si falla la query del estado, permitir fichar de todas
    // formas. Antes devolvía canPunch=false → widget mostraba "Fuera de
    // turno" engañosamente cuando era un error de carga.
    return { status: "stopped", canPunch: true, reason: "No se pudo cargar el estado" };
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
): Promise<PunchResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const noGeo = input.geo_latitude == null || input.geo_longitude == null;
    const nowIso = new Date().toISOString();

    // ---- Validar coherencia: 1 sola jornada al día ----
    // Una jornada = 1 clock_in + descansos arbitrarios + 1 clock_out.
    // No se permite reabrir tras cerrar, ni cerrar dos veces.
    // Los errores se DEVUELVEN (no se lanzan) para que el mensaje
    // sobreviva el serializado de Server Actions en producción.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: todayPunches } = await admin
      .from("time_punches")
      .select("punch_kind, punched_at")
      .eq("user_id", session.user_id)
      .gte("punched_at", todayStart.toISOString())
      .order("punched_at", { ascending: true });
    type P = { punch_kind: PunchKind; punched_at: string };
    const todays = (todayPunches ?? []) as P[];
    const hasClockIn = todays.some((p) => p.punch_kind === "clock_in");
    const hasClockOut = todays.some((p) => p.punch_kind === "clock_out");
    const lastKind = todays[todays.length - 1]?.punch_kind ?? null;

    if (kind === "clock_in") {
      if (hasClockIn) {
        return {
          ok: false,
          error: "Ya fichaste entrada hoy. No puedes abrir otra jornada en el mismo día.",
        };
      }
    } else if (kind === "clock_out") {
      if (!hasClockIn) {
        return { ok: false, error: "No has fichado entrada hoy. Ficha primero la entrada." };
      }
      if (hasClockOut) {
        return { ok: false, error: "Ya fichaste salida hoy." };
      }
      if (lastKind === "break_start") {
        return { ok: false, error: "Estás en descanso. Reanuda antes de fichar la salida." };
      }
    } else if (kind === "break_start") {
      if (!hasClockIn) {
        return { ok: false, error: "Ficha entrada antes de iniciar un descanso." };
      }
      if (hasClockOut) {
        return { ok: false, error: "La jornada ya está cerrada." };
      }
      if (lastKind === "break_start") {
        return { ok: false, error: "Ya estás en descanso. Reanuda primero." };
      }
    } else if (kind === "break_end") {
      if (lastKind !== "break_start") {
        return { ok: false, error: "No hay un descanso abierto que reanudar." };
      }
    }
    // INSERT con todos los campos. Si la migración 20260503320000 (que añade
    // needs_geo_review/accuracy_meters) aún no se ha aplicado, reintentar
    // con el set mínimo de columnas que sí existen desde el inicio.
    const fullPayload: Record<string, unknown> = {
      company_id: session.company_id,
      user_id: session.user_id,
      punch_kind: kind,
      punched_at: nowIso,
      geo_latitude: input.geo_latitude,
      geo_longitude: input.geo_longitude,
      accuracy_meters: input.accuracy_meters,
      needs_geo_review: noGeo,
      is_manual: false,
    };
    let insertError = (await admin.from("time_punches").insert(fullPayload))
      .error as { message?: string } | null;
    if (
      insertError &&
      /column .* does not exist|needs_geo_review|accuracy_meters/i.test(
        insertError.message ?? "",
      )
    ) {
      console.warn("[punchKindAction] retry sin columnas nuevas:", insertError.message);
      const minimalPayload: Record<string, unknown> = {
        company_id: session.company_id,
        user_id: session.user_id,
        punch_kind: kind,
        punched_at: nowIso,
        geo_latitude: input.geo_latitude,
        geo_longitude: input.geo_longitude,
        is_manual: false,
      };
      insertError = (await admin.from("time_punches").insert(minimalPayload))
        .error as { message?: string } | null;
    }
    if (insertError) {
      console.error("[punchKindAction insert]", insertError);
      return {
        ok: false,
        error: insertError.message ?? "Error al insertar fichaje",
      };
    }

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
    try {
      revalidatePath("/fichajes");
    } catch {
      /* no-op */
    }

    // Devolver estado fresco. Si getMyClockExtended falla por algún motivo
    // (tabla user_work_schedules no existe aún, etc.) construir uno mínimo
    // basado en el INSERT recién hecho para que el widget refleje el cambio.
    try {
      const state = await getMyClockExtended();
      return { ok: true, state };
    } catch (err) {
      console.error("[punchKindAction getMyClockExtended]", err);
      const status =
        kind === "clock_in" || kind === "break_end"
          ? ("working" as const)
          : kind === "break_start"
            ? ("on_break" as const)
            : ("stopped" as const);
      return {
        ok: true,
        state: {
          status,
          since: status === "working" || status === "on_break" ? nowIso : undefined,
          canPunch: true,
        },
      };
    }
  } catch (err) {
    console.error("[punchKindAction outer]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido al fichar",
    };
  }
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

/**
 * Listado completo (admin) o por dpto (director) de fichajes en un rango.
 */
export async function listPunchesAdmin(filters: {
  from: string;
  to: string;
  user_id?: string;
  /** Filtros adicionales para el histórico (todos opcionales). */
  kind?: PunchKind;
  only_no_geo?: boolean;
  only_manual?: boolean;
  only_autoclosed?: boolean;
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
  if (filters.kind) q = q.eq("punch_kind", filters.kind);
  if (filters.only_no_geo) q = q.eq("needs_geo_review", true);
  if (filters.only_manual) q = q.eq("is_manual", true);
  if (filters.only_autoclosed) q = q.eq("auto_closed", true);
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

/** Lista usuarios de la empresa (para el filtro de historico). */
export async function listCompanyUsersForFilter(): Promise<
  Array<{ user_id: string; full_name: string }>
> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // user_profiles NO tiene email ni deleted_at — sólo full_name + status.
  // Combinamos con user_roles para detectar usuarios con rol activo aunque
  // no tengan perfil completo (caso recién creado).
  const profilesRes = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .eq("company_id", session.company_id)
    .order("full_name");
  if (profilesRes.error) {
    console.error("[listCompanyUsersForFilter profiles]", profilesRes.error.message);
  }
  const rolesRes = await admin
    .from("user_roles")
    .select("user_id")
    .eq("company_id", session.company_id)
    .is("revoked_at", null);
  if (rolesRes.error) {
    console.error("[listCompanyUsersForFilter roles]", rolesRes.error.message);
  }
  type U = { user_id: string; full_name: string | null };
  const seen = new Map<string, U>();
  for (const p of ((profilesRes.data ?? []) as U[])) {
    if (p.user_id) seen.set(p.user_id, p);
  }
  for (const r of ((rolesRes.data ?? []) as Array<{ user_id: string }>)) {
    if (r.user_id && !seen.has(r.user_id)) {
      seen.set(r.user_id, { user_id: r.user_id, full_name: null });
    }
  }
  return Array.from(seen.values()).map((u) => ({
    user_id: u.user_id,
    full_name: u.full_name || `Usuario ${u.user_id.slice(0, 6)}`,
  }));
}

/** Editar fichaje (admin/director), deja huella de quién y por qué.
 *  Devuelve { ok, error } para que el mensaje sobreviva en producción. */
export async function editPunchAction(input: {
  punch_id: string;
  /** Nueva hora ISO (con timezone). */
  punched_at: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!input.reason || input.reason.trim().length < 3) {
      return { ok: false, error: "Motivo obligatorio (al menos 3 caracteres)" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("time_punches")
      .update({
        punched_at: input.punched_at,
        is_manual: true,
        edited_by_admin: session.user_id,
        edited_reason: input.reason.trim(),
      })
      .eq("id", input.punch_id)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/fichajes");
    revalidatePath("/fichajes/admin");
    revalidatePath("/fichajes/admin/historico");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al editar",
    };
  }
}

/** Admin/director crea un fichaje manual para otro usuario (caso: el
 *  empleado olvidó fichar y no presentó solicitud). Marca is_manual=true
 *  y edited_by_admin para trazabilidad. */
export async function adminCreatePunchAction(input: {
  user_id: string;
  punch_kind: PunchKind;
  /** ISO con timezone. */
  punched_at: string;
  reason: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!input.reason || input.reason.trim().length < 3) {
      return { ok: false, error: "Motivo obligatorio" };
    }
    if (
      !["clock_in", "clock_out", "break_start", "break_end"].includes(
        input.punch_kind,
      )
    ) {
      return { ok: false, error: "Tipo de fichaje inválido" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Verificar que el user_id pertenece a la empresa
    const { data: prof } = await admin
      .from("user_profiles")
      .select("user_id")
      .eq("user_id", input.user_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!prof) {
      return {
        ok: false,
        error: "El usuario no pertenece a tu empresa",
      };
    }
    const ins = await admin
      .from("time_punches")
      .insert({
        company_id: session.company_id,
        user_id: input.user_id,
        punch_kind: input.punch_kind,
        punched_at: input.punched_at,
        geo_latitude: null,
        geo_longitude: null,
        needs_geo_review: false,
        is_manual: true,
        edited_by_admin: session.user_id,
        edited_reason: input.reason.trim(),
      })
      .select("id")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };
    const id = (ins.data as { id: string } | null)?.id ?? "";

    // Notificar al empleado
    try {
      await admin.from("notifications").insert({
        company_id: session.company_id,
        recipient_user_id: input.user_id,
        kind: "time_tracking.admin_created",
        severity: "info",
        title: "Admin ha registrado un fichaje",
        body: `Se ha añadido un fichaje en tu nombre: ${input.punch_kind === "clock_in" ? "entrada" : input.punch_kind === "clock_out" ? "salida" : input.punch_kind === "break_start" ? "inicio de descanso" : "fin de descanso"} a las ${new Date(input.punched_at).toLocaleString("es-ES")}.`,
      });
    } catch {
      /* fail-soft */
    }

    revalidatePath("/fichajes");
    revalidatePath("/fichajes/admin");
    revalidatePath("/fichajes/admin/historico");
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al crear fichaje",
    };
  }
}

/** Admin/director elimina un fichaje (soft no aplica — borrado físico
 *  pero queda en events). Útil para fichajes duplicados o erróneos. */
export async function adminDeletePunchAction(
  punchId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!reason || reason.trim().length < 3) {
      return { ok: false, error: "Motivo obligatorio" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Capturar datos antes para audit
    const { data: prev } = await admin
      .from("time_punches")
      .select("user_id, punch_kind, punched_at")
      .eq("id", punchId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    const r = await admin
      .from("time_punches")
      .delete()
      .eq("id", punchId)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };

    if (prev) {
      const p = prev as {
        user_id: string;
        punch_kind: string;
        punched_at: string;
      };
      try {
        await admin.from("events").insert({
          company_id: session.company_id,
          subject_type: "user",
          subject_id: p.user_id,
          kind: "time_tracking.punch_deleted",
          payload: {
            punch_kind: p.punch_kind,
            punched_at: p.punched_at,
            reason: reason.trim(),
            deleted_by: session.user_id,
          },
        });
      } catch {
        /* fail-soft */
      }
    }
    revalidatePath("/fichajes");
    revalidatePath("/fichajes/admin");
    revalidatePath("/fichajes/admin/historico");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al eliminar fichaje",
    };
  }
}

/** Cierra los fichajes abiertos +2h tras fin de jornada. Llama al RPC. */
export async function autoCloseStalePunchesAction(): Promise<{ closed: number }> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin.rpc("autoclose_stale_punches");
  return { closed: Number(data) || 0 };
}

/** Listado de usuarios sin fichar hoy (para notificaciones).
 *  Excluye automáticamente:
 *   - Usuarios sin horario hoy (festivos personales / día libre del cuadrante).
 *   - Usuarios con ausencia APROBADA cuyo rango incluye hoy
 *     (vacaciones, baja, permiso, maternidad/paternidad, etc.).
 *   - Festivos de la empresa (time_holidays para hoy).
 */
export async function getUsersWithoutPunchTodayAction(): Promise<
  Array<{ user_id: string; full_name: string }>
> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayIso = todayStart.toISOString().slice(0, 10); // YYYY-MM-DD
  const dow = (now.getDay() + 6) % 7; // lunes=0

  // Si hoy es festivo de empresa, nadie está obligado a fichar.
  // Holidays globales (company_id IS NULL) o de empresa.
  try {
    const { data: hols } = await admin
      .from("holidays")
      .select("id")
      .eq("holiday_date", todayIso)
      .or(`company_id.eq.${session.company_id},company_id.is.null`)
      .limit(1);
    if ((hols ?? []).length > 0) return [];
  } catch {
    /* tabla puede no estar migrada en algunos entornos */
  }

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

  // Quitar a los que están de ausencia aprobada que cubre hoy.
  let onLeave = new Set<string>();
  try {
    const { data: abs } = await admin
      .from("time_absences")
      .select("user_id")
      .eq("company_id", session.company_id)
      .eq("status", "approved")
      .lte("starts_on", todayIso)
      .gte("ends_on", todayIso)
      .in("user_id", expected);
    onLeave = new Set(
      ((abs ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    );
  } catch {
    /* tabla no migrada → sin filtro */
  }
  const expectedActive = expected.filter((u) => !onLeave.has(u));
  if (expectedActive.length === 0) return [];

  const { data: punched } = await admin
    .from("time_punches")
    .select("user_id")
    .eq("company_id", session.company_id)
    .gte("punched_at", todayStart.toISOString())
    .in("user_id", expectedActive);
  const punchedSet = new Set(((punched ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));

  const missing = expectedActive.filter((u) => !punchedSet.has(u));
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
