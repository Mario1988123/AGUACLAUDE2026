"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  type StepImportance,
} from "./steps-config";

export interface OnboardingStepState extends OnboardingStep {
  status: "pending" | "completed" | "postponed";
  completed_at: string | null;
  postponed_until: string | null;
}

export interface OnboardingSummary {
  steps: OnboardingStepState[];
  totals: {
    required_pending: number;
    recommended_pending: number;
    optional_pending: number;
    completed: number;
    total: number;
  };
}

/**
 * Devuelve el estado de los pasos de onboarding de la empresa actual.
 * Combina catálogo en código + tabla company_onboarding_steps + auto-check
 * en BD para steps con `auto_check`.
 */
export async function getOnboardingSummary(): Promise<OnboardingSummary> {
  const session = await requireSession();
  const empty: OnboardingSummary = {
    steps: [],
    totals: {
      required_pending: 0,
      recommended_pending: 0,
      optional_pending: 0,
      completed: 0,
      total: ONBOARDING_STEPS.length,
    },
  };
  if (!session.company_id) return empty;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Cargar estados registrados
  const { data: rowsRaw } = await admin
    .from("company_onboarding_steps")
    .select("step_key, completed_at, postponed_until")
    .eq("company_id", session.company_id);
  type Row = {
    step_key: string;
    completed_at: string | null;
    postponed_until: string | null;
  };
  const byKey = new Map<string, Row>();
  for (const r of ((rowsRaw ?? []) as Row[])) {
    byKey.set(r.step_key, r);
  }

  // 2) Auto-check para steps que lo soporten
  const autoCompleted = new Set<string>();
  for (const step of ONBOARDING_STEPS) {
    if (!step.auto_check) continue;
    try {
      let q = admin
        .from(step.auto_check.table)
        .select("id", { count: "exact", head: true });
      if (step.auto_check.where) {
        for (const [k, v] of Object.entries(step.auto_check.where)) {
          q = q.eq(k, v);
        }
      }
      // Filtro por company_id si la tabla lo tiene
      try {
        q = q.eq("company_id", session.company_id);
      } catch {
        /* no todas las tablas filtran por company_id */
      }
      const { count } = await q;
      const c = count ?? 0;
      if (step.auto_check.min_count && c >= step.auto_check.min_count) {
        autoCompleted.add(step.key);
      } else if (step.auto_check.not_null_column && c > 0) {
        // Necesitamos verificar también la columna NOT NULL
        const { data: row } = await admin
          .from(step.auto_check.table)
          .select(step.auto_check.not_null_column)
          .eq("company_id", session.company_id)
          .maybeSingle();
        if (
          row &&
          (row as Record<string, unknown>)[step.auto_check.not_null_column] != null
        ) {
          autoCompleted.add(step.key);
        }
      }
    } catch {
      /* fail-soft: si la tabla no existe o falla, lo dejamos como manual */
    }
  }

  // 3) Construir estado final
  const now = new Date();
  const steps: OnboardingStepState[] = ONBOARDING_STEPS.map((s) => {
    const row = byKey.get(s.key);
    const autoDone = autoCompleted.has(s.key);
    let status: OnboardingStepState["status"] = "pending";
    if (row?.completed_at || autoDone) {
      status = "completed";
    } else if (row?.postponed_until && new Date(row.postponed_until) > now) {
      status = "postponed";
    }
    return {
      ...s,
      status,
      completed_at: row?.completed_at ?? (autoDone ? new Date().toISOString() : null),
      postponed_until: row?.postponed_until ?? null,
    };
  });

  const totals = steps.reduce(
    (acc, s) => {
      if (s.status === "completed") {
        acc.completed += 1;
      } else if (s.status === "pending") {
        if (s.importance === "required") acc.required_pending += 1;
        else if (s.importance === "recommended") acc.recommended_pending += 1;
        else acc.optional_pending += 1;
      }
      return acc;
    },
    {
      required_pending: 0,
      recommended_pending: 0,
      optional_pending: 0,
      completed: 0,
      total: steps.length,
    },
  );

  return { steps, totals };
}

/**
 * Marca un step como completado manualmente.
 */
export async function markOnboardingStepDone(
  stepKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("company_onboarding_steps")
      .upsert(
        {
          company_id: session.company_id,
          step_key: stepKey,
          completed_at: new Date().toISOString(),
          completed_by: session.user_id,
          postponed_until: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,step_key" },
      );
    if (error) return { ok: false, error: error.message };
    revalidatePath("/dashboard");
    revalidatePath("/configuracion");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Aparca un step N días (por defecto 7). No lo marca completado pero lo
 * oculta del card del dashboard hasta esa fecha.
 */
export async function postponeOnboardingStep(
  stepKey: string,
  days = 7,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const until = new Date();
    until.setDate(until.getDate() + days);
    const { error } = await admin
      .from("company_onboarding_steps")
      .upsert(
        {
          company_id: session.company_id,
          step_key: stepKey,
          postponed_until: until.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,step_key" },
      );
    if (error) return { ok: false, error: error.message };
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export type { StepImportance };
