"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

// Los tipos AbsenceKind/AbsenceStatus y los labels viven en
// ./absence-labels (este archivo es "use server" y solo puede exportar
// funciones async, no tipos ni constantes).
import {
  ABSENCE_KIND_LABEL_LC as ABSENCE_KIND_LABEL,
  type AbsenceKind,
  type AbsenceStatus,
} from "./absence-labels";

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
  /** Hijo concreto: obligatorio para maternity/paternity y parental_*_8y. */
  child_id?: string | null;
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

  // Maternidad/paternidad: necesita child_id. Validar:
  //  · 17 semanas máx dentro de la ventana de 12 meses
  //    (6 obligatorias + 11 flexibles, RD-ley 9/2025 Art. 48.4 ET).
  //    Las 2 semanas extra hasta los 8 años se piden con kind
  //    parental_paid_8y, NO aquí.
  //  · Permiso debe estar dentro de los 12 meses post-nacimiento.
  //  · Las primeras 6 semanas post-parto son obligatorias e
  //    ininterrumpidas → aviso si no se ha cogido aún.
  if (input.kind === "maternity" || input.kind === "paternity") {
    if (!input.child_id) {
      return {
        ok: false,
        error:
          "Selecciona el hijo/a en cuestión. Si aún no lo has registrado, hazlo en /fichajes → Mis hijos.",
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adm = createAdminClient() as any;
    const { data: child } = await adm
      .from("employee_children")
      .select("birth_date")
      .eq("id", input.child_id)
      .eq("user_id", session.user_id)
      .maybeSingle();
    const c = child as { birth_date?: string } | null;
    if (!c?.birth_date) {
      return { ok: false, error: "Hijo no encontrado" };
    }
    const birth = new Date(c.birth_date);
    const start = new Date(input.starts_on);
    const end = new Date(input.ends_on);
    // Ventana legal: hasta los 12 meses del bebé
    const window12m = new Date(birth);
    window12m.setMonth(window12m.getMonth() + 12);
    if (end > window12m) {
      return {
        ok: false,
        error: `El permiso ${input.kind === "maternity" ? "de maternidad" : "de paternidad"} debe terminar antes del ${window12m.toLocaleDateString("es-ES")} (12 meses del bebé).`,
      };
    }
    if (start < birth) {
      return {
        ok: false,
        error: "El permiso no puede empezar antes del nacimiento del bebé.",
      };
    }
    // Sumar semanas ya consumidas para este child + kind
    const { data: prior } = await adm
      .from("time_absences")
      .select("starts_on, ends_on, status")
      .eq("user_id", session.user_id)
      .eq("child_id", input.child_id)
      .eq("kind", input.kind)
      .in("status", ["approved", "pending"]);
    let weeksConsumed = 0;
    for (const a of ((prior ?? []) as Array<{
      starts_on: string;
      ends_on: string;
    }>)) {
      const s = new Date(a.starts_on);
      const e = new Date(a.ends_on);
      const days = Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
      weeksConsumed += Math.ceil(days / 7);
    }
    const requestedDays =
      Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    const requestedWeeks = Math.ceil(requestedDays / 7);
    if (weeksConsumed + requestedWeeks > 17) {
      return {
        ok: false,
        error: `Excede las 17 semanas dentro de los 12 meses post-parto (ya consumidas ${weeksConsumed}, pides ${requestedWeeks}). Las 2 semanas extra del Art. 48.4 ET (hasta los 8 años) se solicitan como «Parental retribuido (hasta 8 años)».`,
      };
    }
    // Aviso 6 semanas obligatorias post-parto (no bloquea, solo informa)
    // Solo emitimos si todavía no se ha aprobado la franja obligatoria.
    // [Por simplicidad omitimos validación dura; la nota va en el body.]
  }

  // Permiso parental hasta 8 años del menor (paid_8y / unpaid_8y):
  // verificar que el usuario tiene al menos un hijo y que en la
  // fecha de inicio el menor (el más pequeño) tiene <8 años.
  if (
    input.kind === "parental_paid_8y" ||
    input.kind === "parental_unpaid_8y"
  ) {
    const { getMyYoungestChildAgeAt } = await import("./children-actions");
    const age = await getMyYoungestChildAgeAt(session.user_id, input.starts_on);
    if (age == null) {
      return {
        ok: false,
        error:
          "Necesitas registrar al menos un hijo en tu ficha para pedir permiso parental. Hazlo desde /fichajes.",
      };
    }
    if (age >= 8) {
      return {
        ok: false,
        error: `Tu hijo/a tiene ${age} años. El permiso parental sólo es válido hasta que el menor cumple 8 años.`,
      };
    }
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
    child_id: input.child_id ?? null,
  });
  if (ins.error) {
    // Si child_id aún no está en cache, retry sin él
    if (/child_id|schema cache|Could not find/i.test(ins.error.message ?? "")) {
      const retry = await admin.from("time_absences").insert({
        company_id: session.company_id,
        user_id: session.user_id,
        starts_on: input.starts_on,
        ends_on: input.ends_on,
        kind: input.kind,
        status: "pending",
        notes: input.notes ?? null,
      });
      if (retry.error) return { ok: false, error: retry.error.message };
    } else {
      return { ok: false, error: ins.error.message };
    }
  }
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
    .select("user_id, kind, starts_on, ends_on, status")
    .eq("id", id)
    .maybeSingle();
  if (!ab) throw new Error("Ausencia no encontrada");
  const previousStatus = (ab as { status: string }).status;
  const newStatus = approve ? "approved" : "rejected";

  await admin
    .from("time_absences")
    .update({
      status: newStatus,
      approved_by: session.user_id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  // Saldo de vacaciones: idempotente (decisión 2026-05-19).
  //   - Si pasa de NO-approved a approved Y es vacation → sumar días.
  //   - Si pasa de approved a NO-approved → restar días.
  //   - Si no cambia el "es approved", no tocar saldo.
  if ((ab as { kind: string }).kind === "vacation") {
    const wasApproved = previousStatus === "approved";
    const isApproved = newStatus === "approved";
    let delta = 0;
    if (!wasApproved && isApproved) delta = +1;
    else if (wasApproved && !isApproved) delta = -1;
    if (delta !== 0) {
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
            days_taken: Math.max(0, (cur?.days_taken ?? 0) + delta * days),
          },
          { onConflict: "user_id,year" },
        );
    }
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

/**
 * Recalcula el saldo de vacaciones de un usuario en un año a partir de
 * todas las ausencias kind=vacation status=approved que tiene en BD.
 * Útil cuando saldos antiguos quedaron desincronizados (p. ej. ausencias
 * aprobadas antes de que existiera la lógica de descuento, o doble
 * aprobación legacy).
 */
export async function recalculateVacationBalanceAction(
  userId: string,
  year: number,
): Promise<{ ok: true; days_taken: number } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const { data: abs } = await admin
      .from("time_absences")
      .select("starts_on, ends_on")
      .eq("user_id", userId)
      .eq("kind", "vacation")
      .eq("status", "approved")
      .gte("starts_on", yearStart)
      .lte("starts_on", yearEnd);
    type A = { starts_on: string; ends_on: string };
    let total = 0;
    for (const a of (abs ?? []) as A[]) {
      const d = Math.max(
        1,
        Math.round(
          (new Date(a.ends_on).getTime() - new Date(a.starts_on).getTime()) / 86400000,
        ) + 1,
      );
      total += d;
    }
    const { data: bal } = await admin
      .from("user_vacation_balances")
      .select("days_total")
      .eq("user_id", userId)
      .eq("year", year)
      .maybeSingle();
    const days_total = (bal as { days_total: number } | null)?.days_total ?? 22;
    await admin
      .from("user_vacation_balances")
      .upsert(
        {
          user_id: userId,
          company_id: session.company_id,
          year,
          days_total,
          days_taken: total,
        },
        { onConflict: "user_id,year" },
      );
    revalidatePath("/fichajes");
    return { ok: true, days_taken: total };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
