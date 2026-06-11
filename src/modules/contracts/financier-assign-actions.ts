"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { reconcileSalesRecordsForCompany } from "@/modules/sales/reconcile";

async function ensureAdminOrLevel2() {
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director");
  return { session, allowed };
}

/**
 * Tras cambiar los datos de financiera de un contrato, regeneramos sus
 * `sales_records` con force=true para que el total_cents refleje el nuevo
 * `financier_payment_cents` (ya descontado el coeficiente). Si la
 * regeneración falla, lo silenciamos: el cron diario reconcilia.
 */
async function regenerateContractSalesRecords(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  contractId: string,
) {
  try {
    await reconcileSalesRecordsForCompany(admin, companyId, {
      force: true,
      onlyContractIds: [contractId],
    });
  } catch (e) {
    console.error(
      "[financier-assign] reconcile sales_records failed:",
      e instanceof Error ? e.message : e,
    );
  }
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
    const { session, allowed } = await ensureAdminOrLevel2();
    if (!allowed) {
      return {
        ok: false,
        error: "Solo admin / director puede asignar financiera al contrato",
      };
    }
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
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
    // SEGURIDAD: admin client salta RLS → filtrar por company_id para no
    // sobrescribir la financiera de un contrato de otra empresa.
    const r = await admin
      .from("contracts")
      .update(payload)
      .eq("id", parsed.contract_id)
      .eq("company_id", session.company_id)
      .select("id");
    if (r.error) return { ok: false, error: r.error.message };
    if (!r.data?.length)
      return { ok: false, error: "Contrato no encontrado o no pertenece a tu empresa" };

    // events.company_id es NOT NULL → antes el insert fallaba y el rastro de
    // auditoría no se guardaba nunca.
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "contract",
      subject_id: parsed.contract_id,
      kind: "contract.financier_assigned",
      payload: {
        financier_id: parsed.financier_id,
        financier_payment_cents: parsed.financier_payment_cents,
        financier_term_months: parsed.financier_term_months,
      },
      actor_user_id: session.user_id,
    });

    if (session.company_id) {
      await regenerateContractSalesRecords(
        admin,
        session.company_id,
        parsed.contract_id,
      );
    }

    revalidatePath(`/contratos/${parsed.contract_id}`);
    revalidatePath("/wallet/financieras");
    revalidatePath("/dashboard");
    revalidatePath("/objetivos");
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
    const { session, allowed } = await ensureAdminOrLevel2();
    if (!allowed) {
      return {
        ok: false,
        error: "Solo admin / director puede modificar la financiera del contrato",
      };
    }
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // SEGURIDAD: admin client salta RLS → filtrar por company_id.
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
      .eq("id", contractId)
      .eq("company_id", session.company_id)
      .select("id");
    if (r.error) return { ok: false, error: r.error.message };
    if (!r.data?.length)
      return { ok: false, error: "Contrato no encontrado o no pertenece a tu empresa" };

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "contract",
      subject_id: contractId,
      kind: "contract.financier_cleared",
      payload: {},
      actor_user_id: session.user_id,
    });

    if (session.company_id) {
      await regenerateContractSalesRecords(admin, session.company_id, contractId);
    }

    revalidatePath(`/contratos/${contractId}`);
    revalidatePath("/dashboard");
    revalidatePath("/objetivos");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
