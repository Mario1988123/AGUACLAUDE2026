"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export type WhosInBucket = "working" | "break" | "absence" | "out";

export interface WhosInPerson {
  user_id: string;
  full_name: string;
  /** Hora ISO de la última transición (entrada / inicio descanso). */
  since: string | null;
  /** Si está de ausencia, etiqueta humana (Vacaciones / Baja / ...). */
  absence_label: string | null;
}

export interface WhosInSnapshot {
  working: WhosInPerson[];
  on_break: WhosInPerson[];
  absences: WhosInPerson[];
  out: WhosInPerson[];
}

const ABSENCE_LABEL: Record<string, string> = {
  vacation: "Vacaciones",
  sick: "Baja",
  personal: "Asunto personal",
  training: "Formación",
  other: "Ausencia",
};

/** Devuelve quién está trabajando / en pausa / ausente / fuera ahora mismo.
 *  Visible para todo el equipo (no requiere rol admin). */
export async function getWhosInSnapshot(): Promise<WhosInSnapshot> {
  const session = await requireSession();
  if (!session.company_id) {
    return { working: [], on_break: [], absences: [], out: [] };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Lista de usuarios de la empresa. Mostramos todos (incluso invited
   // y suspended). Combinamos user_profiles + user_roles porque puede haber
   // perfil sin rol o rol sin perfil; queremos cualquier usuario asociado
   // a la empresa.
  type U = { user_id: string; full_name: string | null };
  const profilesRes = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .eq("company_id", session.company_id);
  if (profilesRes.error) {
    console.error("[whos-in profiles]", profilesRes.error.message);
  }
  const rolesRes = await admin
    .from("user_roles")
    .select("user_id")
    .eq("company_id", session.company_id)
    .is("revoked_at", null);
  if (rolesRes.error) {
    console.error("[whos-in roles]", rolesRes.error.message);
  }
  const seen = new Map<string, U>();
  for (const p of ((profilesRes.data ?? []) as U[])) {
    if (p.user_id) seen.set(p.user_id, p);
  }
  for (const r of ((rolesRes.data ?? []) as Array<{ user_id: string }>)) {
    if (r.user_id && !seen.has(r.user_id)) {
      seen.set(r.user_id, { user_id: r.user_id, full_name: null });
    }
  }
  // Asegurar que el usuario actual aparece aunque no esté en ninguna tabla.
  if (!seen.has(session.user_id)) {
    seen.set(session.user_id, {
      user_id: session.user_id,
      full_name: session.full_name ?? null,
    });
  }
  const userList = Array.from(seen.values());
  if (userList.length === 0) {
    return { working: [], on_break: [], absences: [], out: [] };
  }
  const userIds = userList.map((u) => u.user_id);
  const userMap = new Map<string, U>(userList.map((u) => [u.user_id, u]));

  // 2) Último fichaje de hoy por usuario (para clasificar working / break / out)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: punches } = await admin
    .from("time_punches")
    .select("user_id, punch_kind, punched_at")
    .eq("company_id", session.company_id)
    .in("user_id", userIds)
    .gte("punched_at", todayStart.toISOString())
    .order("punched_at", { ascending: false });
  type P = { user_id: string; punch_kind: string; punched_at: string };
  const punchRows = (punches ?? []) as P[];
  const lastByUser = new Map<string, P>();
  for (const p of punchRows) {
    if (!lastByUser.has(p.user_id)) lastByUser.set(p.user_id, p);
  }

  // 3) Ausencias aprobadas que solapan hoy
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: abs } = await admin
    .from("time_absences")
    .select("user_id, kind, starts_on, ends_on")
    .eq("company_id", session.company_id)
    .eq("status", "approved")
    .lte("starts_on", todayStr)
    .gte("ends_on", todayStr);
  type A = { user_id: string; kind: string; starts_on: string; ends_on: string };
  const absentMap = new Map<string, A>();
  for (const a of (abs ?? []) as A[]) {
    if (!absentMap.has(a.user_id)) absentMap.set(a.user_id, a);
  }

  // 4) Clasificar
  const working: WhosInPerson[] = [];
  const onBreak: WhosInPerson[] = [];
  const absences: WhosInPerson[] = [];
  const out: WhosInPerson[] = [];

  for (const u of userList) {
    const name = u.full_name || `Usuario ${u.user_id.slice(0, 6)}`;
    const personBase = {
      user_id: u.user_id,
      full_name: name,
    };
    const a = absentMap.get(u.user_id);
    if (a) {
      absences.push({
        ...personBase,
        since: a.starts_on,
        absence_label: ABSENCE_LABEL[a.kind] ?? a.kind,
      });
      continue;
    }
    const last = lastByUser.get(u.user_id);
    if (!last) {
      out.push({ ...personBase, since: null, absence_label: null });
      continue;
    }
    if (last.punch_kind === "clock_in" || last.punch_kind === "break_end") {
      // Resolver "since" = primer clock_in del día
      const firstIn = punchRows
        .filter((p) => p.user_id === u.user_id && p.punch_kind === "clock_in")
        .map((p) => p.punched_at)
        .sort()[0];
      working.push({
        ...personBase,
        since: firstIn ?? last.punched_at,
        absence_label: null,
      });
    } else if (last.punch_kind === "break_start") {
      onBreak.push({
        ...personBase,
        since: last.punched_at,
        absence_label: null,
      });
    } else {
      // clock_out u otro → fuera
      out.push({ ...personBase, since: last.punched_at, absence_label: null });
    }
  }

  // Eliminar al propio session.user_id de "out" si está? No, mejor
  // mantenerlo para que se vea a sí mismo en la vista del equipo.
  return { working, on_break: onBreak, absences, out };
}
