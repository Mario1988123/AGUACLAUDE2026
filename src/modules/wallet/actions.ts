"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { walletEntryCreateSchema } from "./schemas";
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let query = supabase
    .from("wallet_entries")
    .select(
      "id, concept, amount_cents, method, status, collected_by_user_id, collected_at, validated_at, contract_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director")
  ) {
    query = query.eq("collected_by_user_id", session.user_id);
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
  const parsed = walletEntryCreateSchema.parse(input);

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
