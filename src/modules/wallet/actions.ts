"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { walletEntryCreateSchema } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { notifyPaymentPendingValidation } from "@/modules/notifications/notifier";

export interface WalletEntryRow {
  id: string;
  concept: string;
  amount_cents: number;
  method: string;
  status: string;
  collected_by_user_id: string | null;
  collected_at: string | null;
  validated_at: string | null;
  contract_id: string | null;
  created_at: string;
}

export async function listWalletEntries(filters?: {
  method?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<WalletEntryRow[]> {
  const session = await requireSession();
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let query = supabase
    .from("wallet_entries")
    .select(
      "id, concept, amount_cents, method, status, collected_by_user_id, collected_at, validated_at, contract_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  // Director comercial ahora ve cobros de su equipo via team_assignments
  // (antes solo veía los suyos). Nivel 1 ve todos. Nivel 3 solo los suyos.
  if (visibleUserIds) {
    query = query.in("collected_by_user_id", visibleUserIds);
  }
  if (filters?.method) query = query.eq("method", filters.method);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.fromDate) query = query.gte("created_at", filters.fromDate);
  if (filters?.toDate) query = query.lte("created_at", filters.toDate);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as WalletEntryRow[];
}

export async function getWalletSummary() {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("wallet_entries")
    .select("status, amount_cents, collected_by_user_id");
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    status: string;
    amount_cents: number;
    collected_by_user_id: string | null;
  }>;
  const filtered =
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director")
      ? rows.filter((r) => r.collected_by_user_id === session.user_id)
      : rows;
  const sum = (st: string) =>
    filtered.filter((r) => r.status === st).reduce((s, r) => s + r.amount_cents, 0);
  return {
    pending_cents: sum("pending"),
    collected_cents: sum("collected"),
    pending_settlement_cents: sum("pending_settlement"),
    settled_cents: sum("settled"),
    validated_cents: sum("validated"),
  };
}

export async function createWalletEntryAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = parseOrFriendly(walletEntryCreateSchema, input, "Cobro");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Estado inicial según método y rol
  // Cash → cobrado por nivel 3, pending_settlement
  // Otros → collected_pending_validation
  let status: string;
  if (parsed.method === "cash") status = "pending_settlement";
  else status = "collected";

  const { data: created, error } = await supabase
    .from("wallet_entries")
    .insert({
      company_id: session.company_id,
      contract_id: parsed.contract_id || null,
      customer_id: parsed.customer_id || null,
      installation_id: parsed.installation_id || null,
      concept: parsed.concept,
      amount_cents: parsed.amount_cents,
      method: parsed.method,
      status,
      collected_by_user_id: session.user_id,
      collected_at: new Date().toISOString(),
      notes: parsed.notes || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Si requiere validación admin, avisar
  if (status === "collected" && created) {
    await notifyPaymentPendingValidation(
      session.company_id,
      (created as { id: string }).id,
      parsed.amount_cents,
      parsed.concept,
      parsed.method,
    );
  }

  revalidatePath("/wallet");
  if (parsed.contract_id) revalidatePath(`/contratos/${parsed.contract_id}`);
}

export async function validateWalletEntryAction(id: string) {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director")
  ) {
    throw new Error("Solo admin/director puede validar");
  }
  // Admin client + verificación de count: la policy we_update filtra por
  // scope (admin / wallet:approve:dept / collected_by own). Si el director
  // no es del scope correcto, el UPDATE silenciaría.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: entry } = await admin
    .from("wallet_entries")
    .select("id, contract_id, collected_by_user_id, concept, amount_cents")
    .eq("id", id)
    .maybeSingle();
  const e = entry as
    | {
        id: string;
        contract_id: string | null;
        collected_by_user_id: string | null;
        concept: string;
        amount_cents: number;
      }
    | null;
  if (!e) throw new Error("Entrada no encontrada");
  const r = await admin
    .from("wallet_entries")
    .update({
      status: "validated",
      validated_at: new Date().toISOString(),
      validated_by_user_id: session.user_id,
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  // Event timeline + notify al cobrador
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "wallet_entry",
    subject_id: id,
    kind: "wallet.payment_validated",
    payload: { amount_cents: e.amount_cents },
    actor_user_id: session.user_id,
  });
  if (e.collected_by_user_id && e.collected_by_user_id !== session.user_id) {
    try {
      await admin.from("notifications").insert({
        company_id: session.company_id,
        recipient_user_id: e.collected_by_user_id,
        kind: "wallet.payment_validated",
        severity: "success",
        title: "Cobro validado",
        body: e.concept,
        subject_type: "wallet_entry",
        subject_id: id,
        action_url: "/wallet",
      });
    } catch {
      /* no-op */
    }
  }
  revalidatePath("/wallet");
}

export async function rejectWalletEntryAction(id: string, reason: string) {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director")
  ) {
    throw new Error("Solo admin/director puede rechazar");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: entry } = await admin
    .from("wallet_entries")
    .select("id, collected_by_user_id, concept, amount_cents")
    .eq("id", id)
    .maybeSingle();
  const e = entry as
    | {
        id: string;
        collected_by_user_id: string | null;
        concept: string;
        amount_cents: number;
      }
    | null;
  if (!e) throw new Error("Entrada no encontrada");
  const r = await admin
    .from("wallet_entries")
    .update({
      status: "rejected",
      rejected_reason: reason,
      validated_by_user_id: session.user_id,
      validated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "wallet_entry",
    subject_id: id,
    kind: "wallet.payment_rejected",
    payload: { reason, amount_cents: e.amount_cents },
    actor_user_id: session.user_id,
  });
  if (e.collected_by_user_id && e.collected_by_user_id !== session.user_id) {
    try {
      await admin.from("notifications").insert({
        company_id: session.company_id,
        recipient_user_id: e.collected_by_user_id,
        kind: "wallet.payment_rejected",
        severity: "warning",
        title: "Cobro rechazado",
        body: `${e.concept}: ${reason}`,
        subject_type: "wallet_entry",
        subject_id: id,
        action_url: "/wallet",
      });
    } catch {
      /* no-op */
    }
  }
  revalidatePath("/wallet");
}

/**
 * Marca un cobro pendiente (ej. "pago en oficina pendiente") como
 * cobrado. Útil cuando el cliente finalmente paga y hay que actualizar
 * el estado en lugar de crear otra entrada.
 */
export async function markWalletAsCollectedAction(id: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: entry } = await admin
    .from("wallet_entries")
    .select("id, status, method, contract_id, contract_payment_id, amount_cents, concept, company_id")
    .eq("id", id)
    .maybeSingle();
  const e = entry as
    | {
        id: string;
        status: string;
        method: string;
        contract_id: string | null;
        contract_payment_id: string | null;
        amount_cents: number;
        concept: string;
        company_id: string;
      }
    | null;
  if (!e) throw new Error("Cobro no encontrado");
  if (e.company_id !== session.company_id) throw new Error("Cobro de otra empresa");
  if (e.status !== "pending" && e.status !== "rejected" && e.status !== "cancelled") {
    throw new Error(
      `Solo se puede marcar cobrado desde pendiente/rechazado (estado actual: ${e.status})`,
    );
  }
  const newStatus = e.method === "cash" ? "pending_settlement" : "collected";
  const r = await admin
    .from("wallet_entries")
    .update({
      status: newStatus,
      collected_by_user_id: session.user_id,
      collected_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  if (e.contract_payment_id) {
    await admin
      .from("contract_payments")
      .update({
        status: "collected_pending_validation",
        moment: "now",
        collected_at: new Date().toISOString(),
        collected_by_user_id: session.user_id,
      })
      .eq("id", e.contract_payment_id);
  }
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "wallet_entry",
    subject_id: id,
    kind: "wallet.payment_marked_collected",
    payload: { amount_cents: e.amount_cents, from_status: e.status },
    actor_user_id: session.user_id,
  });
  if (e.contract_id) revalidatePath(`/contratos/${e.contract_id}`);
  revalidatePath("/wallet");
}

/**
 * Cancela un cobro pendiente o rechazado (el cliente no pagará).
 */
export async function cancelWalletEntryAction(id: string, reason: string) {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director")
  ) {
    throw new Error("Solo admin/director puede cancelar");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: entry } = await admin
    .from("wallet_entries")
    .select("id, status, contract_id, contract_payment_id, company_id, amount_cents")
    .eq("id", id)
    .maybeSingle();
  const e = entry as
    | {
        id: string;
        status: string;
        contract_id: string | null;
        contract_payment_id: string | null;
        company_id: string;
        amount_cents: number;
      }
    | null;
  if (!e) throw new Error("Cobro no encontrado");
  if (e.company_id !== session.company_id) throw new Error("Cobro de otra empresa");
  if (e.status === "validated" || e.status === "settled") {
    throw new Error("No se puede cancelar un cobro ya validado/liquidado");
  }
  const r = await admin
    .from("wallet_entries")
    .update({
      status: "cancelled",
      rejected_reason: reason || "Cancelado por el usuario",
      validated_by_user_id: session.user_id,
      validated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  if (e.contract_payment_id) {
    await admin
      .from("contract_payments")
      .update({ wallet_entry_id: null, status: "pending" })
      .eq("id", e.contract_payment_id);
  }
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "wallet_entry",
    subject_id: id,
    kind: "wallet.payment_cancelled",
    payload: { reason, amount_cents: e.amount_cents },
    actor_user_id: session.user_id,
  });
  if (e.contract_id) revalidatePath(`/contratos/${e.contract_id}`);
  revalidatePath("/wallet");
}
