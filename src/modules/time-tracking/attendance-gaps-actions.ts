"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { adminCreateAbsenceAction } from "./leave-budget-actions";

export interface AttendanceGapRow {
  id: string;
  user_id: string;
  user_name: string | null;
  gap_date: string;
  status: "pending" | "classified" | "dismissed";
  classified_kind: string | null;
  classified_at: string | null;
}

async function ensureAdminOrDirector() {
  const session = await requireSession();
  const ok =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!ok) throw new Error("Solo admin / director");
  return session;
}

export async function listPendingAttendanceGaps(): Promise<AttendanceGapRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("attendance_gaps")
    .select("id, user_id, gap_date, status, classified_kind, classified_at")
    .eq("company_id", session.company_id)
    .eq("status", "pending")
    .order("gap_date", { ascending: false })
    .limit(200);
  if (error) {
    console.warn("[listPendingAttendanceGaps]", error.message);
    return [];
  }
  type R = Omit<AttendanceGapRow, "user_name">;
  const rows = (data ?? []) as R[];
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profs } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in("user_id", ids);
  const nameMap = new Map<string, string>();
  for (const p of (profs ?? []) as Array<{
    user_id: string;
    full_name: string | null;
  }>) {
    nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
  }
  return rows.map((r) => ({ ...r, user_name: nameMap.get(r.user_id) ?? null }));
}

/** Clasifica el gap creando la ausencia correspondiente y marcando el
 *  gap como classified. Si kind="dismissed" se marca como descartado
 *  (ej. era el cumpleaños del CEO, día regalo). */
export async function classifyAttendanceGapAction(input: {
  gap_id: string;
  classification:
    | "vacation"
    | "sick"
    | "personal"
    | "training"
    | "other"
    | "paternity"
    | "maternity"
    | "marriage"
    | "bereavement"
    | "lactation"
    | "parental_paid_8y"
    | "parental_unpaid_8y"
    | "mudanza"
    | "civic_duty"
    | "dismissed";
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: gap } = await admin
      .from("attendance_gaps")
      .select("id, user_id, gap_date, status")
      .eq("id", input.gap_id)
      .maybeSingle();
    const g = gap as
      | { id: string; user_id: string; gap_date: string; status: string }
      | null;
    if (!g) return { ok: false, error: "Gap no encontrado" };
    if (g.status !== "pending")
      return { ok: false, error: "Ya está clasificado" };

    if (input.classification === "dismissed") {
      await admin
        .from("attendance_gaps")
        .update({
          status: "dismissed",
          classified_by: session.user_id,
          classified_at: new Date().toISOString(),
          classified_notes: input.notes ?? null,
        })
        .eq("id", input.gap_id);
      revalidatePath("/fichajes/admin");
      return { ok: true };
    }

    // Crear ausencia retroactiva
    const r = await adminCreateAbsenceAction({
      user_id: g.user_id,
      kind: input.classification,
      starts_on: g.gap_date,
      ends_on: g.gap_date,
      notes: input.notes ?? null,
    });
    if (!r.ok) return { ok: false, error: r.error };

    await admin
      .from("attendance_gaps")
      .update({
        status: "classified",
        classified_kind: input.classification,
        classified_by: session.user_id,
        classified_at: new Date().toISOString(),
        classified_notes: input.notes ?? null,
      })
      .eq("id", input.gap_id);

    revalidatePath("/fichajes/admin");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error",
    };
  }
}
