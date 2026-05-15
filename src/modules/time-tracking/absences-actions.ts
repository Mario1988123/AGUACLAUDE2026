"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export type AbsenceKind = "vacation" | "sick" | "personal" | "training" | "other";
export type AbsenceStatus = "pending" | "approved" | "rejected" | "cancelled";

const ABSENCE_KIND_LABEL: Record<AbsenceKind, string> = {
  vacation: "vacaciones",
  sick: "baja médica",
  personal: "asunto personal",
  training: "formación",
  other: "ausencia",
};

export interface AbsenceRow {
  id: string;
  user_id: string;
  user_name: string | null;
  starts_on: string;
  ends_on: string;
  kind: AbsenceKind;
  status: AbsenceStatus;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function submitAbsenceAction(input: {
  starts_on: string;
  ends_on: string;
  kind: AbsenceKind;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // Si pide vacaciones, validar ventanas + cap
  if (input.kind === "vacation") {
    const { checkVacationRequestAllowed } = await import(
      "./vacation-windows-actions"
    );
    const check = await checkVacationRequestAllowed({
      user_id: session.user_id,
      starts_on: input.starts_on,
      ends_on: input.ends_on,
    });
    if (!check.ok) return { ok: false, error: check.reason };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const ins = await admin.from("time_absences").insert({
    company_id: session.company_id,
    user_id: session.user_id,
    starts_on: input.starts_on,
    ends_on: input.ends_on,
    kind: input.kind,
    status: "pending",
    notes: input.notes ?? null,
  });
  if (ins.error) return { ok: false, error: ins.error.message };
  // Notificar a los admins
  const { data: admins } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("company_id", session.company_id)
    .eq("role_key", "company_admin")
    .is("revoked_at", null);
  for (const a of (admins ?? []) as Array<{ user_id: string }>) {
    await admin.from("notifications").insert({
      company_id: session.company_id,
      recipient_user_id: a.user_id,
      kind: "absence_request",
      severity: "info",
      title: "Solicitud de ausencia",
      body: `${session.full_name ?? session.email} solicita ${ABSENCE_KIND_LABEL[input.kind]} del ${input.starts_on} al ${input.ends_on}`,
    });
  }
  revalidatePath("/fichajes");
  return { ok: true };
}

export async function listAbsences(filters?: {
  status?: AbsenceStatus;
  user_id?: string;
}): Promise<AbsenceRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("time_absences")
    .select(
      "id, user_id, starts_on, ends_on, kind, status, notes, approved_by, approved_at, created_at",
    )
    .eq("company_id", session.company_id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (!isAdmin) q = q.eq("user_id", session.user_id);
  if (filters?.user_id) q = q.eq("user_id", filters.user_id);
  if (filters?.status) q = q.eq("status", filters.status);
  const { data } = await q;
  type R = Omit<AbsenceRow, "user_name">;
  const rows = (data ?? []) as R[];
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

export async function approveAbsenceAction(id: string, approve: boolean): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: ab } = await admin
    .from("time_absences")
    .select("user_id, kind, starts_on, ends_on")
    .eq("id", id)
    .maybeSingle();
  await admin
    .from("time_absences")
    .update({
      status: approve ? "approved" : "rejected",
      approved_by: session.user_id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  // Si es vacaciones aprobadas, descontar saldo
  if (approve && ab && (ab as { kind: string }).kind === "vacation") {
    const a = ab as { user_id: string; starts_on: string; ends_on: string };
    const days = Math.max(
      1,
      Math.round(
        (new Date(a.ends_on).getTime() - new Date(a.starts_on).getTime()) / 86400000,
      ) + 1,
    );
    const year = new Date(a.starts_on).getFullYear();
    const { data: bal } = await admin
      .from("user_vacation_balances")
      .select("days_taken, days_total")
      .eq("user_id", a.user_id)
      .eq("year", year)
      .maybeSingle();
    const cur = bal as { days_taken: number; days_total: number } | null;
    await admin
      .from("user_vacation_balances")
      .upsert(
        {
          user_id: a.user_id,
          company_id: session.company_id,
          year,
          days_total: cur?.days_total ?? 22,
          days_taken: (cur?.days_taken ?? 0) + days,
        },
        { onConflict: "user_id,year" },
      );
  }

  // Notificar al solicitante
  if (ab) {
    await admin.from("notifications").insert({
      company_id: session.company_id,
      recipient_user_id: (ab as { user_id: string }).user_id,
      kind: "absence_decision",
      severity: approve ? "success" : "warning",
      title: approve ? "Ausencia aprobada" : "Ausencia rechazada",
      body: `Solicitud del ${(ab as { starts_on: string }).starts_on} al ${(ab as { ends_on: string }).ends_on}`,
    });
  }
  revalidatePath("/fichajes");
}
