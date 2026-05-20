"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const reassignSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(200),
  user_id: z.string().uuid().nullable(),
});

/**
 * Reasigna múltiples leads a un comercial. Si user_id es null, los desasigna.
 * Solo admin de empresa. Devuelve result discriminado para que el cliente
 * vea el mensaje real en producción (Next redacta los throw).
 */
export async function bulkReassignLeadsAction(
  input: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isAdmin =
      session.is_superadmin || session.roles.includes("company_admin");
    if (!isAdmin) {
      return { ok: false, error: "Solo el admin de empresa puede reasignar" };
    }

    const parsed = parseOrFriendly(reassignSchema, input, "Reasignar leads");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;

    const update: Record<string, unknown> = {
      assigned_user_id: parsed.user_id,
      assigned_at: parsed.user_id ? new Date().toISOString() : null,
      assigned_by: session.user_id,
    };

    const { error, count } = await supabase
      .from("leads")
      .update(update)
      .in("id", parsed.lead_ids)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .select("*", { count: "exact", head: true });
    if (error) return { ok: false, error: error.message };

    await supabase.from("events").insert(
      parsed.lead_ids.map((id) => ({
        company_id: session.company_id,
        subject_type: "lead",
        subject_id: id,
        kind: "lead.reassigned",
        payload: { to_user_id: parsed.user_id },
        actor_user_id: session.user_id,
      })),
    );

    if (parsed.user_id) {
      await supabase.from("notifications").insert(
        parsed.lead_ids.map((id) => ({
          company_id: session.company_id,
          recipient_user_id: parsed.user_id,
          kind: "lead_assigned",
          severity: "info",
          title:
            parsed.lead_ids.length === 1
              ? "Te han asignado un lead"
              : "Te han asignado leads",
          body: "Revisa /leads para empezar a gestionarlo.",
          subject_type: "lead",
          subject_id: id,
        })),
      );
    }

    revalidatePath("/leads");
    return { ok: true, count: count ?? parsed.lead_ids.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Cambia status masivo de leads. Nivel 1/2 sólo (decisión 2026-05-20).
 * Útil para director que quiere marcar lote como "lost" / "expired".
 */
import type { LeadStatus } from "./types";

export async function bulkUpdateLeadsStatusAction(input: {
  lead_ids: string[];
  status: LeadStatus;
  reason?: string;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("commercial_director") &&
      !session.roles.includes("telemarketing_director")
    ) {
      return { ok: false, error: "Permisos insuficientes" };
    }
    if (input.lead_ids.length === 0)
      return { ok: false, error: "Sin leads seleccionados" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const update: Record<string, unknown> = { status: input.status };
    if (input.status === "lost" && input.reason) {
      update.lost_reason = input.reason;
    }
    const { data: updated, error } = await admin
      .from("leads")
      .update(update)
      .in("id", input.lead_ids)
      .eq("company_id", session.company_id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    const count = ((updated ?? []) as Array<{ id: string }>).length;

    // Eventos
    for (const r of (updated ?? []) as Array<{ id: string }>) {
      try {
        await admin.from("events").insert({
          company_id: session.company_id,
          subject_type: "lead",
          subject_id: r.id,
          kind: "lead.status_changed",
          payload: { status: input.status, bulk: true },
          actor_user_id: session.user_id,
        });
      } catch {
        /* */
      }
    }
    revalidatePath("/leads");
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
