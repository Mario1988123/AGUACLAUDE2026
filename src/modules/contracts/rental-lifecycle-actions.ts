"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

type Result = { ok: true } | { ok: false; error: string };

async function ensureAdminOrDirector() {
  const session = await requireSession();
  if (!session.company_id) {
    return { ok: false as const, error: "Sin empresa", session: null };
  }
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!allowed) {
    return {
      ok: false as const,
      error: "Solo admin o director comercial puede gestionar alquileres",
      session: null,
    };
  }
  return { ok: true as const, session };
}

/**
 * Pausa un contrato de alquiler. Mientras paused_at IS NOT NULL:
 *  - El cron de facturación mensual NO genera nueva cuota.
 *  - El cron de pausa-largas detecta paused_at + 30 días y programa
 *    mantenimiento preventivo (el equipo sigue instalado).
 *  - El contrato sigue contando como activo en KPIs.
 */
const pauseSchema = z.object({
  contract_id: z.string().uuid(),
  reason: z.string().trim().min(1, "Indica el motivo de la pausa"),
});

export async function pauseRentalAction(input: unknown): Promise<Result> {
  try {
    const auth = await ensureAdminOrDirector();
    if (!auth.ok) return { ok: false, error: auth.error };
    const parsed = parseOrFriendly(pauseSchema, input, "Pausar alquiler");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: row } = await admin
      .from("contracts")
      .select("id, status, plan_type, company_id, paused_at")
      .eq("id", parsed.contract_id)
      .maybeSingle();
    const c = row as
      | {
          id: string;
          status: string;
          plan_type: string;
          company_id: string;
          paused_at: string | null;
        }
      | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.company_id !== auth.session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (c.plan_type !== "rental")
      return { ok: false, error: "Solo aplica a alquileres" };
    if (!["signed", "active"].includes(c.status))
      return { ok: false, error: `Contrato en estado ${c.status}` };
    if (c.paused_at)
      return { ok: false, error: "Ya está pausado" };

    const r = await admin
      .from("contracts")
      .update({
        paused_at: new Date().toISOString(),
        pause_reason: parsed.reason,
      })
      .eq("id", parsed.contract_id);
    if (r.error) return { ok: false, error: r.error.message };

    await admin.from("events").insert({
      company_id: c.company_id,
      subject_type: "contract",
      subject_id: parsed.contract_id,
      kind: "contract.rental_paused",
      payload: { reason: parsed.reason },
      actor_user_id: auth.session.user_id,
    });

    revalidatePath(`/contratos/${parsed.contract_id}`);
    revalidatePath("/contratos/alquileres");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Reanuda un contrato de alquiler pausado. La facturación mensual vuelve
 * a generarse en el próximo cron del día 1.
 */
export async function resumeRentalAction(
  contractId: string,
): Promise<Result> {
  try {
    const auth = await ensureAdminOrDirector();
    if (!auth.ok) return { ok: false, error: auth.error };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: row } = await admin
      .from("contracts")
      .select("id, company_id, paused_at, pause_reason")
      .eq("id", contractId)
      .maybeSingle();
    const c = row as
      | { id: string; company_id: string; paused_at: string | null; pause_reason: string | null }
      | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.company_id !== auth.session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (!c.paused_at) return { ok: false, error: "El contrato no está pausado" };

    const r = await admin
      .from("contracts")
      .update({ paused_at: null, pause_reason: null })
      .eq("id", contractId);
    if (r.error) return { ok: false, error: r.error.message };

    await admin.from("events").insert({
      company_id: c.company_id,
      subject_type: "contract",
      subject_id: contractId,
      kind: "contract.rental_resumed",
      payload: {
        previous_pause_reason: c.pause_reason,
        paused_at: c.paused_at,
      },
      actor_user_id: auth.session.user_id,
    });

    revalidatePath(`/contratos/${contractId}`);
    revalidatePath("/contratos/alquileres");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Prorroga un contrato N meses. Incrementa duration_months y guarda el
 * original en duration_months_original la primera vez (snapshot). NO
 * regenera el PDF — la prórroga queda anotada en eventos y en el badge
 * de la cartera ("Original 24m + 6 prórroga").
 */
const extendSchema = z.object({
  contract_id: z.string().uuid(),
  extra_months: z.coerce.number().int().min(1).max(120),
  reason: z.string().trim().min(1, "Indica el motivo"),
});

export async function extendRentalAction(input: unknown): Promise<Result> {
  try {
    const auth = await ensureAdminOrDirector();
    if (!auth.ok) return { ok: false, error: auth.error };
    const parsed = parseOrFriendly(extendSchema, input, "Prorrogar alquiler");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: row } = await admin
      .from("contracts")
      .select(
        "id, status, plan_type, company_id, duration_months, duration_months_original",
      )
      .eq("id", parsed.contract_id)
      .maybeSingle();
    const c = row as
      | {
          id: string;
          status: string;
          plan_type: string;
          company_id: string;
          duration_months: number | null;
          duration_months_original: number | null;
        }
      | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.company_id !== auth.session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (c.plan_type !== "rental")
      return { ok: false, error: "Solo aplica a alquileres" };
    if (!["signed", "active"].includes(c.status))
      return { ok: false, error: `Contrato en estado ${c.status}` };

    const previousDuration = c.duration_months ?? 0;
    const newDuration = previousDuration + parsed.extra_months;
    const updates: Record<string, unknown> = { duration_months: newDuration };
    if (c.duration_months_original == null) {
      updates.duration_months_original = previousDuration;
    }
    const r = await admin
      .from("contracts")
      .update(updates)
      .eq("id", parsed.contract_id);
    if (r.error) return { ok: false, error: r.error.message };

    await admin.from("events").insert({
      company_id: c.company_id,
      subject_type: "contract",
      subject_id: parsed.contract_id,
      kind: "contract.rental_extended",
      payload: {
        previous_duration_months: previousDuration,
        extra_months: parsed.extra_months,
        new_duration_months: newDuration,
        reason: parsed.reason,
      },
      actor_user_id: auth.session.user_id,
    });

    revalidatePath(`/contratos/${parsed.contract_id}`);
    revalidatePath("/contratos/alquileres");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
