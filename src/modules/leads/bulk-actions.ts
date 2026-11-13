"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import type { LeadStatus } from "./types";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { ROLES_CON_LEADS, clienteDebeSeguirAlLead } from "./inactividad-logica";

const reassignSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(200),
  user_id: z.string().uuid().nullable(),
});

/** Roles que pueden recibir leads al repartir: comerciales y el propio admin. */
const ROLES_DESTINO_REPARTO = [...ROLES_CON_LEADS, "company_admin"];

/**
 * Reasigna múltiples leads a un comercial. Si user_id es null, los desasigna.
 * Solo admin de empresa (decisión de Mario 12-11: reparte el admin).
 * Devuelve result discriminado para que el cliente vea el mensaje real en
 * producción (Next redacta los throw).
 *
 * Plan revisión de leads:
 *  - M1: el destinatario debe ser de la empresa, estar activo y tener rol
 *    comercial (o admin).
 *  - Regla 4 (12-11): si el lead ya es cliente, el cliente pasa al nuevo
 *    dueño solo si seguía siendo del dueño anterior del lead.
 */
export async function bulkReassignLeadsAction(
  input: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const companyId = session.company_id;
    const isAdmin =
      session.is_superadmin || session.roles.includes("company_admin");
    if (!isAdmin) {
      return { ok: false, error: "Solo el admin de empresa puede reasignar" };
    }

    const parsed = parseOrFriendly(reassignSchema, input, "Reasignar leads");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // M1: destinatario válido (cliente admin + company_id a mano).
    if (parsed.user_id) {
      const [{ data: perfil }, { data: roles }] = await Promise.all([
        admin
          .from("user_profiles")
          .select("user_id, status")
          .eq("company_id", companyId)
          .eq("user_id", parsed.user_id)
          .maybeSingle(),
        admin
          .from("user_roles")
          .select("role_key")
          .eq("company_id", companyId)
          .eq("user_id", parsed.user_id)
          .is("revoked_at", null),
      ]);
      if (!perfil) {
        return { ok: false, error: "Ese usuario no es de tu empresa" };
      }
      if ((perfil as { status: string | null }).status !== "active") {
        return { ok: false, error: "Ese usuario no está activo" };
      }
      const roleKeys = ((roles ?? []) as Array<{ role_key: string }>).map((r) => r.role_key);
      if (!roleKeys.some((r) => ROLES_DESTINO_REPARTO.includes(r))) {
        return {
          ok: false,
          error: "Solo se pueden asignar leads a comerciales, teleoperadores, directores o admin",
        };
      }
    }

    // Dueño anterior de cada lead (para el evento y para arrastrar al cliente).
    const { data: antes } = await admin
      .from("leads")
      .select("id, assigned_user_id, status, converted_to_customer_id")
      .in("id", parsed.lead_ids)
      .eq("company_id", companyId)
      .is("deleted_at", null);
    const previos = (antes ?? []) as Array<{
      id: string;
      assigned_user_id: string | null;
      status: string;
      converted_to_customer_id: string | null;
    }>;

    const update: Record<string, unknown> = {
      assigned_user_id: parsed.user_id,
      assigned_at: parsed.user_id ? new Date().toISOString() : null,
      assigned_by: session.user_id,
    };

    const { error, count } = await supabase
      .from("leads")
      .update(update)
      .in("id", parsed.lead_ids)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .select("*", { count: "exact", head: true });
    if (error) return { ok: false, error: error.message };

    const previoPorId = new Map(previos.map((p) => [p.id, p]));
    await supabase.from("events").insert(
      previos.map((p) => ({
        company_id: companyId,
        subject_type: "lead",
        subject_id: p.id,
        kind: "lead.reassigned",
        payload: {
          to_user_id: parsed.user_id,
          from_user_id: previoPorId.get(p.id)?.assigned_user_id ?? null,
        },
        actor_user_id: session.user_id,
      })),
    );

    // Regla 4: el cliente sigue al lead convertido.
    const convertidos = previos.filter((p) => p.status === "converted");
    if (convertidos.length > 0 && parsed.user_id) {
      try {
        const leadIds = convertidos.map((p) => p.id);
        const enlazados = convertidos
          .map((p) => p.converted_to_customer_id)
          .filter((x): x is string => !!x);
        // Por converted_to_customer_id o por customers.source_lead_id (los
        // convertidos vía prueba gratuita no tenían el primero).
        const filtroOr = [
          `source_lead_id.in.(${leadIds.join(",")})`,
          ...(enlazados.length > 0 ? [`id.in.(${enlazados.join(",")})`] : []),
        ].join(",");
        const { data: clientes } = await admin
          .from("customers")
          .select("id, assigned_user_id, source_lead_id")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .or(filtroOr);
        for (const c of (clientes ?? []) as Array<{
          id: string;
          assigned_user_id: string | null;
          source_lead_id: string | null;
        }>) {
          const lead =
            convertidos.find((p) => p.converted_to_customer_id === c.id) ??
            convertidos.find((p) => p.id === c.source_lead_id);
          if (!lead) continue;
          if (
            !clienteDebeSeguirAlLead({
              duenoCliente: c.assigned_user_id,
              duenoAnteriorLead: lead.assigned_user_id,
              duenoNuevoLead: parsed.user_id,
            })
          )
            continue;
          await admin
            .from("customers")
            .update({ assigned_user_id: parsed.user_id, assigned_at: new Date().toISOString() })
            .eq("id", c.id)
            .eq("company_id", companyId);
          await admin.from("events").insert({
            company_id: companyId,
            subject_type: "customer",
            subject_id: c.id,
            kind: "customer.reassigned",
            payload: {
              from_user_id: c.assigned_user_id,
              to_user_id: parsed.user_id,
              reason: "lead_reassigned",
              lead_id: lead.id,
            },
            actor_user_id: session.user_id,
          });
        }
      } catch (e) {
        console.error("[bulkReassignLeads] arrastrar cliente del lead:", e);
      }
    }

    if (parsed.user_id && previos.length > 0) {
      await supabase.from("notifications").insert(
        previos.map((p) => ({
          company_id: companyId,
          recipient_user_id: parsed.user_id,
          kind: "lead_assigned",
          severity: "info",
          title:
            previos.length === 1
              ? "Te han asignado un lead"
              : "Te han asignado leads",
          body: "Revisa /leads para empezar a gestionarlo.",
          subject_type: "lead",
          subject_id: p.id,
          action_url: `/leads/${p.id}`,
        })),
      );
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, count: count ?? previos.length };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

/**
 * Cambia status masivo de leads. Nivel 1/2 sólo (decisión 2026-05-20).
 * Útil para director que quiere marcar lote como "lost" / "expired".
 *
 * Plan revisión de leads (M2): «convertido» no se pone en lote (necesita un
 * cliente), se rellenan lost_at / expired_at y se ignoran los borrados.
 */
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
    if (input.status === "converted") {
      return {
        ok: false,
        error: "Un lead pasa a «convertido» al darlo de alta como cliente, no en lote",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const ahora = new Date().toISOString();
    const update: Record<string, unknown> = { status: input.status };
    if (input.status === "lost") {
      update.lost_at = ahora;
      if (input.reason) update.lost_reason = input.reason;
    }
    if (input.status === "expired") update.expired_at = ahora;
    const { data: updated, error } = await admin
      .from("leads")
      .update(update)
      .in("id", input.lead_ids)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
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
    return { ok: false, error: toActionError(e) };
  }
}
