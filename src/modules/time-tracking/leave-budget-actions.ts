"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import type { AbsenceKind } from "./absence-labels";
import { DEFAULT_BUDGETS_2026 } from "./absence-labels";

export interface LeaveBudgetRow {
  id: string;
  user_id: string;
  user_name: string | null;
  year: number;
  kind: AbsenceKind;
  unit: "days" | "hours" | "weeks" | "months";
  budget: number;
  taken: number;
  remaining: number;
  notes: string | null;
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

/** Devuelve los presupuestos del usuario actual (todos los tipos) para
 *  un año. Si un kind no tiene registro, se devuelve con default. */
export async function getMyLeaveBudgets(year: number): Promise<LeaveBudgetRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  return listLeaveBudgetsForUser(session.user_id, year);
}

/** Versión interna que sirve tanto al empleado para sus datos como al
 *  admin para los de cualquier empleado. */
export async function listLeaveBudgetsForUser(
  userId: string,
  year: number,
): Promise<LeaveBudgetRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: rows } = await admin
    .from("user_leave_budgets")
    .select("id, user_id, year, kind, unit, budget, taken, notes")
    .eq("company_id", session.company_id)
    .eq("user_id", userId)
    .eq("year", year);
  const { data: prof } = await admin
    .from("user_profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle();
  const userName =
    (prof as { full_name?: string } | null)?.full_name ?? null;
  const map = new Map<string, LeaveBudgetRow>();
  for (const r of ((rows ?? []) as Array<{
    id: string;
    user_id: string;
    year: number;
    kind: AbsenceKind;
    unit: LeaveBudgetRow["unit"];
    budget: number;
    taken: number;
    notes: string | null;
  }>)) {
    map.set(r.kind, {
      ...r,
      user_name: userName,
      remaining: Number(r.budget) - Number(r.taken),
    });
  }
  // Rellenar con defaults los tipos que no tengan fila
  const out: LeaveBudgetRow[] = [];
  for (const [kind, def] of Object.entries(DEFAULT_BUDGETS_2026)) {
    if (map.has(kind as AbsenceKind)) {
      out.push(map.get(kind as AbsenceKind)!);
    } else if (def.value > 0) {
      out.push({
        id: "",
        user_id: userId,
        user_name: userName,
        year,
        kind: kind as AbsenceKind,
        unit: def.unit,
        budget: def.value,
        taken: 0,
        remaining: def.value,
        notes: null,
      });
    }
  }
  // Orden: vacaciones primero, paternidad/maternidad después
  const order: AbsenceKind[] = [
    "vacation",
    "maternity",
    "paternity",
    "parental_unpaid",
    "lactation",
    "marriage",
    "bereavement",
    "mudanza",
    "civic_duty",
    "training",
    "sick",
    "personal",
    "other",
  ];
  out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return out;
}

const updateSchema = z.object({
  user_id: z.string().uuid(),
  year: z.coerce.number().int(),
  kind: z.string().min(1),
  budget: z.coerce.number().min(0),
  taken: z.coerce.number().min(0).optional(),
  unit: z.enum(["days", "hours", "weeks", "months"]).optional(),
  notes: z.string().optional().nullable(),
});

/** Admin/director actualiza presupuesto o consumo de un empleado.
 *  Crea la fila si no existe. Registra evento de auditoría. */
export async function upsertLeaveBudgetAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(updateSchema, input, "Presupuesto");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const def = DEFAULT_BUDGETS_2026[parsed.kind as AbsenceKind];
    const unit = parsed.unit ?? def?.unit ?? "days";

    // Capturar valor previo para audit
    const { data: prev } = await admin
      .from("user_leave_budgets")
      .select("budget, taken")
      .eq("company_id", session.company_id)
      .eq("user_id", parsed.user_id)
      .eq("year", parsed.year)
      .eq("kind", parsed.kind)
      .maybeSingle();

    const r = await admin
      .from("user_leave_budgets")
      .upsert(
        {
          company_id: session.company_id,
          user_id: parsed.user_id,
          year: parsed.year,
          kind: parsed.kind,
          unit,
          budget: parsed.budget,
          taken: parsed.taken ?? (prev as { taken?: number } | null)?.taken ?? 0,
          notes: parsed.notes ?? null,
        },
        { onConflict: "company_id,user_id,year,kind" },
      );
    if (r.error) return { ok: false, error: r.error.message };

    // Audit
    try {
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: "user",
        subject_id: parsed.user_id,
        kind: "leave_budget.updated",
        payload: {
          year: parsed.year,
          leave_kind: parsed.kind,
          previous: prev,
          new: { budget: parsed.budget, taken: parsed.taken, unit },
          updated_by: session.user_id,
        },
      });
    } catch {
      /* fail-soft */
    }

    revalidatePath("/fichajes");
    revalidatePath("/fichajes/admin");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error",
    };
  }
}

/** Admin/director crea una ausencia manual para un empleado SIN flujo
 *  de petición. Se crea ya como approved. Útil para registrar bajas o
 *  permisos que el empleado no solicitó por el CRM. */
const createSchema = z.object({
  user_id: z.string().uuid(),
  kind: z.string().min(1),
  starts_on: z.string().min(1),
  ends_on: z.string().min(1),
  notes: z.string().optional().nullable(),
});

export async function adminCreateAbsenceAction(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(createSchema, input, "Ausencia manual");
    if (new Date(parsed.ends_on) < new Date(parsed.starts_on)) {
      return { ok: false, error: "Fecha fin antes de inicio" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const ins = await admin
      .from("time_absences")
      .insert({
        company_id: session.company_id,
        user_id: parsed.user_id,
        starts_on: parsed.starts_on,
        ends_on: parsed.ends_on,
        kind: parsed.kind,
        status: "approved",
        approved_by: session.user_id,
        approved_at: new Date().toISOString(),
        notes: parsed.notes ?? null,
      })
      .select("id")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };

    // Si es vacaciones, descontar del presupuesto
    if (parsed.kind === "vacation") {
      const start = new Date(parsed.starts_on);
      const end = new Date(parsed.ends_on);
      let businessDays = 0;
      const cur = new Date(start);
      while (cur <= end) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) businessDays++;
        cur.setDate(cur.getDate() + 1);
      }
      const year = start.getFullYear();
      const { data: bud } = await admin
        .from("user_leave_budgets")
        .select("taken, budget")
        .eq("company_id", session.company_id)
        .eq("user_id", parsed.user_id)
        .eq("year", year)
        .eq("kind", "vacation")
        .maybeSingle();
      const cur_taken = Number((bud as { taken?: number } | null)?.taken ?? 0);
      const cur_budget = Number(
        (bud as { budget?: number } | null)?.budget ?? 22,
      );
      await admin
        .from("user_leave_budgets")
        .upsert(
          {
            company_id: session.company_id,
            user_id: parsed.user_id,
            year,
            kind: "vacation",
            unit: "days",
            budget: cur_budget,
            taken: cur_taken + businessDays,
          },
          { onConflict: "company_id,user_id,year,kind" },
        );
    }

    // Notificar al empleado
    try {
      await admin.from("notifications").insert({
        company_id: session.company_id,
        recipient_user_id: parsed.user_id,
        kind: "absence_admin_created",
        severity: "info",
        title: "Admin ha registrado una ausencia tuya",
        body: `Del ${parsed.starts_on} al ${parsed.ends_on}. Tipo: ${parsed.kind}.`,
      });
    } catch {
      /* fail-soft */
    }

    revalidatePath("/fichajes");
    revalidatePath("/fichajes/admin");
    return {
      ok: true,
      id: (ins.data as { id: string }).id,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error",
    };
  }
}
