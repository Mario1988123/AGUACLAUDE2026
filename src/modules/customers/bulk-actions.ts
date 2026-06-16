"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const reassignSchema = z.object({
  customer_ids: z.array(z.string().uuid()).min(1).max(200),
  user_id: z.string().uuid().nullable(),
});

/**
 * Reasigna múltiples clientes a un comercial. Solo admin/director.
 * Devuelve result discriminado para preservar el mensaje en producción.
 */
export async function bulkReassignCustomersAction(
  input: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isUpper =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director") ||
      session.roles.includes("telemarketing_director");
    if (!isUpper) return { ok: false, error: "Solo admin o director" };

    const parsed = parseOrFriendly(reassignSchema, input, "Reasignar clientes");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;

    const update: Record<string, unknown> = {
      assigned_user_id: parsed.user_id,
      assigned_at: parsed.user_id ? new Date().toISOString() : null,
    };

    const upd = await supabase
      .from("customers")
      .update(update)
      .in("id", parsed.customer_ids)
      .eq("company_id", session.company_id)
      .is("deleted_at", null);
    if (upd.error) return { ok: false, error: upd.error.message };

    await supabase.from("events").insert(
      parsed.customer_ids.map((id) => ({
        company_id: session.company_id,
        subject_type: "customer",
        subject_id: id,
        kind: "customer.reassigned",
        payload: { to_user_id: parsed.user_id },
        actor_user_id: session.user_id,
      })),
    );

    revalidatePath("/clientes");
    return { ok: true, count: parsed.customer_ids.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

const bulkDeleteSchema = z.object({
  customer_ids: z.array(z.string().uuid()).min(1).max(200),
  confirm_word: z.string(),
});

/**
 * Borrado en bloque de clientes (para limpiar una importación y rehacerla).
 * Solo administrador. Exige escribir "borrar". Por cada cliente borra primero
 * sus propuestas (no bloquean) y luego el cliente; direcciones, banco y equipos
 * caen en cascada. Si un cliente tiene contrato/instalación/prueba (FK que
 * protege), se SALTA y se cuenta. Procesa hasta 200 por llamada (el cliente
 * trocea la selección).
 */
export async function bulkDeleteCustomersAction(
  input: unknown,
): Promise<
  { ok: true; deleted: number; skipped: number } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo el administrador puede borrar clientes" };
    }
    const parsed = parseOrFriendly(bulkDeleteSchema, input, "Borrar clientes");
    if ((parsed.confirm_word ?? "").trim().toLowerCase() !== "borrar") {
      return { ok: false, error: "Escribe la palabra «borrar» para confirmar" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    let deleted = 0;
    let skipped = 0;
    for (const id of parsed.customer_ids) {
      // Propuestas son desechables (no bloquean). Sus líneas caen en cascada.
      await admin
        .from("proposals")
        .delete()
        .eq("customer_id", id)
        .eq("company_id", session.company_id);
      // Borrado físico (el .eq company_id impide tocar otra empresa). .select()
      // nos dice si borró de verdad. Si una FK lo protege (contrato/instalación)
      // → del.error → se salta.
      const del = await admin
        .from("customers")
        .delete()
        .eq("id", id)
        .eq("company_id", session.company_id)
        .select("id");
      if (del.error || !del.data?.length) {
        skipped += 1;
        continue;
      }
      deleted += 1;
    }
    revalidatePath("/clientes");
    return { ok: true, deleted, skipped };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
