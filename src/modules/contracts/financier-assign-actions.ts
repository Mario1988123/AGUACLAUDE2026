"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

async function ensureAdminOrLevel2() {
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director");
  return { session, allowed };
}

const assignSchema = z.object({
  contract_id: z.string().uuid(),
  financier_id: z.string().uuid().nullable(),
  /** Capital que percibe la empresa (céntimos). */
  financier_payment_cents: z.coerce.number().int().min(0).nullable(),
  financier_term_months: z.coerce.number().int().positive().nullable(),
  /** Snapshot del coeficiente aplicado. */
  financier_coefficient: z.coerce.number().positive().nullable(),
  financier_residual_cents: z.coerce.number().int().min(0).nullable(),
  financier_reserve_cents: z.coerce.number().int().min(0).nullable(),
});

/** Asigna financiera + capital empresa + coeficiente al contrato.
 *  Admin lo ejecuta después de que la financiera acepte la solicitud
 *  (envía a varias, una contesta, admin marca cuál fue). */
export async function assignFinancierToContractAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { allowed } = await ensureAdminOrLevel2();
    if (!allowed) {
      return {
        ok: false,
        error: "Solo admin / director puede asignar financiera al contrato",
      };
    }
    const parsed = parseOrFriendly(assignSchema, input, "Asignación financiera");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const payload: Record<string, unknown> = {
      financier_id: parsed.financier_id,
      financier_payment_cents: parsed.financier_payment_cents,
      financier_term_months: parsed.financier_term_months,
      financier_coefficient: parsed.financier_coefficient,
      financier_residual_cents: parsed.financier_residual_cents,
      financier_reserve_cents: parsed.financier_reserve_cents,
    };
    const r = await admin
      .from("contracts")
      .update(payload)
      .eq("id", parsed.contract_id);
    if (r.error) return { ok: false, error: r.error.message };

    await admin.from("events").insert({
      subject_type: "contract",
      subject_id: parsed.contract_id,
      kind: "contract.financier_assigned",
      payload: {
        financier_id: parsed.financier_id,
        financier_payment_cents: parsed.financier_payment_cents,
        financier_term_months: parsed.financier_term_months,
      },
    });

    revalidatePath(`/contratos/${parsed.contract_id}`);
    revalidatePath("/wallet/financieras");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/** Elimina la financiera asignada (por si admin se equivoca y quiere
 *  reasignar a otra). Pone todos los campos financier_* a null. */
export async function clearFinancierFromContractAction(
  contractId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { allowed } = await ensureAdminOrLevel2();
    if (!allowed) {
      return {
        ok: false,
        error: "Solo admin / director puede modificar la financiera del contrato",
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("contracts")
      .update({
        financier_id: null,
        financier_payment_cents: null,
        financier_term_months: null,
        financier_coefficient: null,
        financier_residual_cents: null,
        financier_reserve_cents: null,
      })
      .eq("id", contractId);
    if (r.error) return { ok: false, error: r.error.message };

    await admin.from("events").insert({
      subject_type: "contract",
      subject_id: contractId,
      kind: "contract.financier_cleared",
      payload: {},
    });

    revalidatePath(`/contratos/${contractId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
