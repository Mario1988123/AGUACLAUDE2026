"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

// ============================================================================
// Fase C — generar CONTRATOS HEREDADOS desde la modalidad de cada equipo.
// ----------------------------------------------------------------------------
// 1 contrato por equipo con acquisition_type puesto, idempotente (no repite
// por source_equipment_id). Decisiones Mario 2026-06-16:
//   - cash (venta)   → contrato contado, total_cash_cents, sin cobros.
//   - rental (alquiler) → contrato alquiler activo, monthly_cents = importe,
//     billing_starts_at = 1º del mes siguiente (cobra desde el próximo mes).
//   - renting        → contrato renting, SIN cuota del CRM (cobra la
//     financiera); el importe queda anotado.
//   - maintenance_included = false (el mantenimiento ya va por equipo).
// ============================================================================

export interface LegacyContractsResult {
  created: number;
  remaining: number;
  errors: number;
}

export async function generateLegacyContractsAction(input?: {
  limit?: number;
}): Promise<
  { ok: true; result: LegacyContractsResult } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo el administrador puede generar contratos heredados" };
    }
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Equipos con modalidad puesta, activos, de la empresa.
    const eqRes = await admin
      .from("customer_equipment")
      .select(
        "id, customer_id, acquisition_type, acquisition_amount_cents, acquisition_started_at",
      )
      .eq("company_id", session.company_id)
      .eq("is_active", true)
      .not("acquisition_type", "is", null);
    if (eqRes.error) {
      if (/acquisition_/i.test(eqRes.error.message ?? "")) {
        return { ok: false, error: "Aplica antes la migración 20260628100000 (campos de modalidad)." };
      }
      return { ok: false, error: eqRes.error.message };
    }
    type EQ = {
      id: string;
      customer_id: string;
      acquisition_type: "cash" | "rental" | "renting" | null;
      acquisition_amount_cents: number | null;
      acquisition_started_at: string | null;
    };
    const equipment = ((eqRes.data ?? []) as EQ[]).filter((e) => e.acquisition_type);

    // Equipos que YA tienen contrato heredado (idempotencia).
    const conRes = await admin
      .from("contracts")
      .select("source_equipment_id")
      .eq("company_id", session.company_id)
      .not("source_equipment_id", "is", null);
    if (conRes.error && /source_equipment_id/i.test(conRes.error.message ?? "")) {
      return { ok: false, error: "Aplica antes la migración 20260629100000 (contratos heredados)." };
    }
    const done = new Set(
      ((conRes.data ?? []) as Array<{ source_equipment_id: string | null }>)
        .map((c) => c.source_equipment_id)
        .filter(Boolean) as string[],
    );

    const pending = equipment.filter((e) => !done.has(e.id));
    const batch = pending.slice(0, limit);
    const result: LegacyContractsResult = {
      created: 0,
      remaining: pending.length - batch.length,
      errors: 0,
    };
    if (batch.length === 0) return { ok: true, result };

    // Base del reference_code "C-YYYY-NNNN".
    const year = new Date().getFullYear();
    const prefix = `C-${year}-`;
    const { data: lastCoded } = await admin
      .from("contracts")
      .select("reference_code")
      .eq("company_id", session.company_id)
      .like("reference_code", `${prefix}%`)
      .order("reference_code", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    const lastCode = (lastCoded as { reference_code: string | null } | null)?.reference_code;
    if (lastCode) {
      const m = lastCode.match(/-(\d+)$/);
      if (m) nextNum = parseInt(m[1]!, 10) + 1;
    }

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      .toISOString()
      .slice(0, 10);

    for (const e of batch) {
      const type = e.acquisition_type as "cash" | "rental" | "renting";
      const amount = e.acquisition_amount_cents ?? null;
      const start = e.acquisition_started_at ?? null;
      const ref = `${prefix}${String(nextNum).padStart(4, "0")}`;
      const eurMonth =
        amount != null
          ? (amount / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })
          : null;
      const payload: Record<string, unknown> = {
        company_id: session.company_id,
        customer_id: e.customer_id,
        plan_type: type,
        status: "active",
        reference_code: ref,
        service_start_date: start,
        signed_at: start ? new Date(start).toISOString() : null,
        maintenance_included: false,
        is_legacy: true,
        source_equipment_id: e.id,
        created_by: session.user_id,
        total_cash_cents: type === "cash" ? amount : null,
        monthly_cents: type === "rental" ? amount : null,
        billing_starts_at: type === "rental" ? nextMonth : null,
        notes:
          type === "renting"
            ? `Contrato heredado (renting). La cuota la cobra la financiera${eurMonth ? ` (${eurMonth} €/mes)` : ""}.`
            : "Contrato heredado de la migración del sistema antiguo.",
      };
      const ins = await admin.from("contracts").insert(payload).select("id").single();
      if (ins.error) {
        if (
          /is_legacy|source_equipment_id|billing_starts_at|schema cache|Could not find/i.test(
            ins.error.message ?? "",
          )
        ) {
          return { ok: false, error: "Aplica antes la migración 20260629100000 (contratos heredados)." };
        }
        result.errors += 1;
        continue;
      }
      nextNum += 1;
      result.created += 1;
    }

    revalidatePath("/contratos");
    revalidatePath("/clientes");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
