"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Reintenta una sub-misión Verifactu rechazada por AEAT (status='failed').
 * Crea una NUEVA submission con attempt_number+1 y status='pending', que
 * será procesada por el siguiente run del cron Verifactu.
 */
export async function retryAeatSubmissionAction(
  submissionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin")
    ) {
      return { ok: false, error: "Solo admin puede reintentar envíos AEAT" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: prev } = await admin
      .from("invoice_aeat_submissions")
      .select("id, company_id, record_id, attempt_number, status")
      .eq("id", submissionId)
      .maybeSingle();
    const p = prev as
      | {
          id: string;
          company_id: string;
          record_id: string;
          attempt_number: number;
          status: string;
        }
      | null;
    if (!p) return { ok: false, error: "Submission no encontrada" };
    if (p.company_id !== session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (p.status !== "failed")
      return { ok: false, error: "Solo se reintentan submissions rechazadas" };

    const { error } = await admin.from("invoice_aeat_submissions").insert({
      company_id: p.company_id,
      record_id: p.record_id,
      attempt_number: p.attempt_number + 1,
      status: "pending",
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/facturas");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
