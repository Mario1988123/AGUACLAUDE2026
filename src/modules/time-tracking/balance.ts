"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface DayBalance {
  date: string;
  worked_minutes: number;
  expected_minutes: number;
  balance_minutes: number;
}

/**
 * Calcula horas trabajadas vs esperadas en un rango. Empareja clock_in /
 * clock_out cronológicamente; descansos restan tiempo. Devuelve agregado
 * por día.
 */
export async function getMyHourBalance(
  fromDate: string,
  toDate: string,
  userId?: string,
): Promise<DayBalance[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const targetUserId = userId ?? session.user_id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const fromIso = new Date(fromDate + "T00:00:00").toISOString();
  const toIso = new Date(toDate + "T23:59:59.999").toISOString();

  const { data: punches } = await admin
    .from("time_punches")
    .select("punch_kind, punched_at")
    .eq("user_id", targetUserId)
    .gte("punched_at", fromIso)
    .lte("punched_at", toIso)
    .order("punched_at");
  const { data: sched } = await admin
    .from("user_work_schedules")
    .select("day_of_week, expected_hours, starts_at, ends_at, break_minutes")
    .eq("user_id", targetUserId);
  // Festivos del rango: tanto los de la empresa como los nacionales (company_id IS NULL).
  // Si la tabla no existe o falla, asumimos sin festivos.
  let holidayDates = new Set<string>();
  try {
    const { data: hol } = await admin
      .from("holidays")
      .select("holiday_date, is_workable, company_id")
      .gte("holiday_date", fromDate)
      .lte("holiday_date", toDate)
      .or(`company_id.eq.${session.company_id},company_id.is.null`);
    type H = {
      holiday_date: string;
      is_workable: boolean | null;
      company_id: string | null;
    };
    holidayDates = new Set(
      ((hol ?? []) as H[])
        .filter((h) => !h.is_workable)
        .map((h) => h.holiday_date),
    );
  } catch {
    /* sin festivos */
  }
  // Ausencias aprobadas que solapen el rango → días con expected=0.
  const absentDates = new Set<string>();
  try {
    const { data: abs } = await admin
      .from("time_absences")
      .select("starts_on, ends_on, status")
      .eq("user_id", targetUserId)
      .eq("status", "approved")
      .lte("starts_on", toDate)
      .gte("ends_on", fromDate);
    type A = { starts_on: string; ends_on: string };
    for (const a of (abs ?? []) as A[]) {
      const start = new Date(a.starts_on + "T00:00:00");
      const end = new Date(a.ends_on + "T00:00:00");
      const cursor = new Date(start);
      while (cursor <= end) {
        absentDates.add(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  } catch {
    /* sin ausencias */
  }

  type P = { punch_kind: string; punched_at: string };
  type S = {
    day_of_week: number;
    expected_hours: number | null;
    starts_at: string | null;
    ends_at: string | null;
    break_minutes: number;
  };
  const ps = (punches ?? []) as P[];
  const ss = (sched ?? []) as S[];

  // Agrupar punches por día
  const byDay = new Map<string, P[]>();
  for (const p of ps) {
    const d = p.punched_at.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(p);
  }

  function expectedFor(date: string): number {
    // Festivo o ausencia aprobada → 0 esperado
    if (holidayDates.has(date) || absentDates.has(date)) return 0;
    const dow = (new Date(date + "T00:00:00").getDay() + 6) % 7;
    const s = ss.find((x) => x.day_of_week === dow);
    if (!s) return 0;
    if (s.expected_hours != null) return Math.round(s.expected_hours * 60);
    if (s.starts_at && s.ends_at) {
      const [sh, sm] = s.starts_at.split(":").map(Number);
      const [eh, em] = s.ends_at.split(":").map(Number);
      return (eh! - sh!) * 60 + (em! - sm!) - (s.break_minutes ?? 0);
    }
    return 0;
  }

  // Construir lista de fechas
  const out: DayBalance[] = [];
  const cur = new Date(fromDate + "T00:00:00");
  const end = new Date(toDate + "T00:00:00");
  while (cur <= end) {
    const dStr = cur.toISOString().slice(0, 10);
    const dayPunches = byDay.get(dStr) ?? [];
    let worked = 0;
    let openIn: number | null = null;
    let breakStart: number | null = null;
    for (const p of dayPunches) {
      const ts = new Date(p.punched_at).getTime();
      if (p.punch_kind === "clock_in") {
        openIn = ts;
      } else if (p.punch_kind === "clock_out" && openIn != null) {
        worked += (ts - openIn) / 60000;
        openIn = null;
      } else if (p.punch_kind === "break_start") {
        breakStart = ts;
      } else if (p.punch_kind === "break_end" && breakStart != null) {
        worked -= (ts - breakStart) / 60000;
        breakStart = null;
      }
    }
    const expected = expectedFor(dStr);
    out.push({
      date: dStr,
      worked_minutes: Math.round(worked),
      expected_minutes: expected,
      balance_minutes: Math.round(worked) - expected,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
