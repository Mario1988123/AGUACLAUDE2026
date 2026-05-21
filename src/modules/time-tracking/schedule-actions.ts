"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface WorkScheduleDay {
  day_of_week: number; // 0=Lun ... 6=Dom
  starts_at: string | null;
  ends_at: string | null;
  break_minutes: number;
  expected_hours: number | null;
}

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getUserSchedule(userId: string): Promise<WorkScheduleDay[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("user_work_schedules")
    .select("day_of_week, starts_at, ends_at, break_minutes, expected_hours")
    .eq("user_id", userId)
    .order("day_of_week");
  return (data ?? []) as WorkScheduleDay[];
}

export async function setUserScheduleAction(
  userId: string,
  days: WorkScheduleDay[],
): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Borrar todos y reinsertar (transacción simple)
  await admin.from("user_work_schedules").delete().eq("user_id", userId);
  const rows = days
    .filter((d) => d.starts_at && d.ends_at)
    .map((d) => ({
      user_id: userId,
      company_id: session.company_id,
      day_of_week: d.day_of_week,
      starts_at: d.starts_at,
      ends_at: d.ends_at,
      break_minutes: d.break_minutes,
      expected_hours: d.expected_hours,
    }));
  if (rows.length > 0) {
    await admin.from("user_work_schedules").insert(rows);
  }
  revalidatePath("/configuracion/horarios");
}

export interface VacationBalance {
  user_id: string;
  user_name: string;
  year: number;
  days_total: number;
  days_taken: number;
  days_remaining: number;
}

export async function listVacationBalances(year: number): Promise<VacationBalance[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: profs } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .eq("company_id", session.company_id)
    .order("full_name");
  type Prof = { user_id: string; full_name: string | null };
  const users = (profs ?? []) as Prof[];
  if (users.length === 0) return [];
  const ids = users.map((u) => u.user_id);
  const { data: bals } = await admin
    .from("user_vacation_balances")
    .select("user_id, year, days_total, days_taken")
    .in("user_id", ids)
    .eq("year", year);
  const map = new Map<string, { days_total: number; days_taken: number }>();
  for (const b of (bals ?? []) as Array<{
    user_id: string;
    days_total: number;
    days_taken: number;
  }>) {
    map.set(b.user_id, { days_total: b.days_total, days_taken: b.days_taken });
  }
  return users.map((u) => {
    const b = map.get(u.user_id) ?? { days_total: 22, days_taken: 0 };
    return {
      user_id: u.user_id,
      user_name: u.full_name ?? u.user_id.slice(0, 8),
      year,
      days_total: b.days_total,
      days_taken: b.days_taken,
      days_remaining: b.days_total - b.days_taken,
    };
  });
}

export async function setVacationDaysAction(
  userId: string,
  year: number,
  daysTotal: number,
): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("user_vacation_balances")
    .upsert(
      {
        user_id: userId,
        company_id: session.company_id,
        year,
        days_total: daysTotal,
      },
      { onConflict: "user_id,year" },
    );
  revalidatePath("/configuracion/horarios");
}

// =================== Safe wrappers ===================

export async function setUserScheduleSafeAction(
  userId: string,
  days: WorkScheduleDay[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setUserScheduleAction(userId, days);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function setVacationDaysSafeAction(
  userId: string,
  year: number,
  daysTotal: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setVacationDaysAction(userId, year, daysTotal);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
