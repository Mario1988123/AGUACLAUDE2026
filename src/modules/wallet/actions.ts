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
  collected_by_name: string | null;
  collected_at: string | null;
  validated_at: string | null;
  contract_id: string | null;
  contract_reference: string | null;
  customer_id: string | null;
  customer_name: string | null;
  invoice_id: string | null;
  invoice_reference: string | null;
  created_at: string;
}

export async function listWalletEntries(filters?: {
  method?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  notInvoiced?: boolean;
}): Promise<WalletEntryRow[]> {
  const session = await requireSession();
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // Defensa-en-profundidad: la columna invoice_id se añadió en
  // 20260511100000. Si la migración no se ha aplicado, hacemos fallback
  // sin esa columna en lugar de reventar la página.
  let query = supabase
    .from("wallet_entries")
    .select(
      "id, concept, amount_cents, method, status, collected_by_user_id, collected_at, validated_at, contract_id, customer_id, invoice_id, created_at, contracts(reference_code), customers(legal_name, trade_name, first_name, last_name), invoices(full_reference, status)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (visibleUserIds) {
    query = query.in("collected_by_user_id", visibleUserIds);
  }
  if (filters?.method) query = query.eq("method", filters.method);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.fromDate) query = query.gte("created_at", filters.fromDate);
  if (filters?.toDate) query = query.lte("created_at", filters.toDate);
  if (filters?.notInvoiced) query = query.is("invoice_id", null);

  // eslint-disable-next-line prefer-const
  let { data, error } = await query;
  if (error && /invoice_id|invoices/i.test(error.message ?? "")) {
    // Fallback sin la migración aplicada
    let q2 = supabase
      .from("wallet_entries")
      .select(
        "id, concept, amount_cents, method, status, collected_by_user_id, collected_at, validated_at, contract_id, customer_id, created_at, contracts(reference_code), customers(legal_name, trade_name, first_name, last_name)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (visibleUserIds) q2 = q2.in("collected_by_user_id", visibleUserIds);
    if (filters?.method) q2 = q2.eq("method", filters.method);
    if (filters?.status) q2 = q2.eq("status", filters.status);
    if (filters?.fromDate) q2 = q2.gte("created_at", filters.fromDate);
    if (filters?.toDate) q2 = q2.lte("created_at", filters.toDate);
    const r2 = await q2;
    if (r2.error) throw r2.error;
    data = r2.data;
  } else if (error) {
    throw error;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseRows = ((data as any[]) ?? []);

  // Resolver nombre del comercial via user_profiles. IMPORTANTE: la RLS
  // de user_profiles típicamente solo deja al user leer su propio perfil.
  // Para mostrar nombres en listados usamos el admin client.
  const userIds = Array.from(new Set(baseRows.map((r) => r.collected_by_user_id).filter(Boolean) as string[]));
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name, display_name")
      .in("user_id", userIds);
    for (const p of ((profiles as { user_id: string; full_name: string | null; display_name: string | null }[] | null) ?? [])) {
      const nice = p.display_name?.trim() || p.full_name?.trim() || p.user_id.slice(0, 8);
      nameMap.set(p.user_id, nice);
    }
  }

  return baseRows.map((r) => ({
    id: r.id,
    concept: r.concept,
    amount_cents: r.amount_cents,
    method: r.method,
    status: r.status,
    collected_by_user_id: r.collected_by_user_id,
    collected_by_name: r.collected_by_user_id
      ? (nameMap.get(r.collected_by_user_id) ?? null)
      : null,
    collected_at: r.collected_at,
    validated_at: r.validated_at,
    contract_id: r.contract_id,
    contract_reference: r.contracts?.reference_code ?? null,
    customer_id: r.customer_id,
    customer_name:
      r.customers?.trade_name ||
      r.customers?.legal_name ||
      [r.customers?.first_name, r.customers?.last_name].filter(Boolean).join(" ") ||
      null,
    invoice_id: r.invoice_id ?? null,
    invoice_reference: r.invoices?.full_reference ?? null,
    created_at: r.created_at,
  }));
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

/**
 * Cambia el método de pago de un wallet entry.
 * Regla:
 *  - pending → cualquiera (el comercial corrige antes de cobrar real).
 *  - collected/pending_settlement/validated → solo admin/director (corregir
 *    error humano en cobro ya registrado).
 *  - rejected/cancelled → solo admin/director.
 */
export async function changeWalletMethodAction(id: string, newMethod: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const allowedMethods = [
    "cash",
    "card",
    "bizum",
    "transfer",
    "direct_debit",
    "financing",
  ];
  if (!allowedMethods.includes(newMethod)) {
    throw new Error("Método inválido");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: row } = await admin
    .from("wallet_entries")
    .select("id, status, method, contract_id, contract_payment_id, company_id")
    .eq("id", id)
    .maybeSingle();
  const e = row as
    | {
        id: string;
        status: string;
        method: string;
        contract_id: string | null;
        contract_payment_id: string | null;
        company_id: string;
      }
    | null;
  if (!e) throw new Error("Cobro no encontrado");
  if (e.company_id !== session.company_id) throw new Error("Otra empresa");

  const isAdminOrDirector =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (e.status !== "pending" && !isAdminOrDirector) {
    throw new Error(
      "Cobro ya registrado. Solo admin o director comercial puede cambiar el método.",
    );
  }
  if (e.method === newMethod) return;

  // Si está cobrado y cambias a efectivo, la liquidación cambia
  // (cash → pending_settlement; resto → collected). Si está pending,
  // dejamos status como está, solo cambiamos method.
  const updates: Record<string, unknown> = { method: newMethod };
  if (e.status === "collected" && newMethod === "cash") {
    updates.status = "pending_settlement";
  } else if (e.status === "pending_settlement" && newMethod !== "cash") {
    updates.status = "collected";
  }
  const r = await admin.from("wallet_entries").update(updates).eq("id", id);
  if (r.error) throw new Error(r.error.message);

  // Sincronizar el contract_payment vinculado
  if (e.contract_payment_id) {
    await admin
      .from("contract_payments")
      .update({ method: newMethod })
      .eq("id", e.contract_payment_id);
  }

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "wallet_entry",
    subject_id: id,
    kind: "wallet.method_changed",
    payload: { from: e.method, to: newMethod, status: e.status },
    actor_user_id: session.user_id,
  });

  if (e.contract_id) revalidatePath(`/contratos/${e.contract_id}`);
  revalidatePath("/wallet");
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
    .select("id, contract_id, collected_by_user_id, concept, amount_cents, method")
    .eq("id", id)
    .maybeSingle();
  const e = entry as
    | {
        id: string;
        contract_id: string | null;
        collected_by_user_id: string | null;
        concept: string;
        amount_cents: number;
        method: string;
      }
    | null;
  if (!e) throw new Error("Entrada no encontrada");
  // Efectivo NUNCA llega al banco — el comercial entrega físicamente al
  // admin → estado final = settled (liquidado).
  // Tarjeta/transfer/bizum/SEPA → admin verifica en banco → validated.
  const finalStatus = e.method === "cash" ? "settled" : "validated";
  const r = await admin
    .from("wallet_entries")
    .update({
      status: finalStatus,
      validated_at: new Date().toISOString(),
      validated_by_user_id: session.user_id,
      ...(finalStatus === "settled" ? { settled_at: new Date().toISOString() } : {}),
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  // Event timeline + notify al cobrador
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "wallet_entry",
    subject_id: id,
    kind: finalStatus === "settled" ? "wallet.payment_settled" : "wallet.payment_validated",
    payload: { amount_cents: e.amount_cents, method: e.method },
    actor_user_id: session.user_id,
  });
  if (e.collected_by_user_id && e.collected_by_user_id !== session.user_id) {
    try {
      await admin.from("notifications").insert({
        company_id: session.company_id,
        recipient_user_id: e.collected_by_user_id,
        kind: finalStatus === "settled" ? "wallet.payment_settled" : "wallet.payment_validated",
        severity: "success",
        title: finalStatus === "settled" ? "Efectivo liquidado" : "Confirmado en banco",
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

// =============================================================================
// Facturación desde wallet
// =============================================================================

export type InvoiceFromWalletResult =
  | { ok: true; invoice_id: string }
  | { ok: false; error: string };

/**
 * Crea una factura borrador a partir de un wallet entry cobrado.
 * Vincula wallet.invoice_id → la factura.
 *
 * El amount_cents del wallet es el TOTAL pagado (con IVA). Separamos
 * base + IVA al 21% por defecto. El admin puede ajustar antes de emitir.
 */
export async function createInvoiceFromWalletAction(
  walletId: string,
): Promise<InvoiceFromWalletResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin puede facturar" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row } = await admin
      .from("wallet_entries")
      .select(
        "id, company_id, customer_id, contract_id, concept, amount_cents, status, invoice_id",
      )
      .eq("id", walletId)
      .maybeSingle();
    const w = row as
      | {
          id: string;
          company_id: string;
          customer_id: string | null;
          contract_id: string | null;
          concept: string;
          amount_cents: number;
          status: string;
          invoice_id: string | null;
        }
      | null;
    if (!w) return { ok: false, error: "Cobro no encontrado" };
    if (w.company_id !== session.company_id) return { ok: false, error: "Otra empresa" };
    if (!w.customer_id) {
      return {
        ok: false,
        error: "El cobro no tiene cliente asociado — no se puede facturar",
      };
    }
    if (w.invoice_id) return { ok: false, error: "Este cobro ya está facturado" };
    if (!["collected", "pending_settlement", "validated", "settled"].includes(w.status)) {
      return {
        ok: false,
        error: `Solo se factura un cobro confirmado (estado actual: ${w.status})`,
      };
    }

    const totalCents = w.amount_cents;
    const baseCents = Math.round(totalCents / 1.21);

    const { createInvoiceAction } = await import("@/modules/invoices/actions");
    const invoiceId = await createInvoiceAction({
      customer_id: w.customer_id,
      contract_id: w.contract_id ?? null,
      kind: "invoice",
      lines: [
        {
          description: w.concept,
          quantity: 1,
          unit_price_cents: baseCents,
          discount_percent: 0,
          tax_rate_percent: 21,
        },
      ],
    });

    await admin
      .from("wallet_entries")
      .update({ invoice_id: invoiceId })
      .eq("id", w.id);

    revalidatePath("/wallet");
    revalidatePath("/facturas");
    if (w.contract_id) revalidatePath(`/contratos/${w.contract_id}`);
    return { ok: true, invoice_id: invoiceId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    console.error("[createInvoiceFromWallet]", e);
    return { ok: false, error: msg };
  }
}

export interface PendingInvoiceRow {
  id: string;
  concept: string;
  amount_cents: number;
  customer_id: string | null;
  customer_name: string | null;
  contract_id: string | null;
  contract_reference: string | null;
  collected_at: string | null;
  collected_by_name: string | null;
  method: string;
}

export async function listPendingInvoiceWalletEntries(): Promise<PendingInvoiceRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (!session.is_superadmin && !session.roles.includes("company_admin")) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("wallet_entries")
    .select(
      "id, concept, amount_cents, method, collected_at, collected_by_user_id, contract_id, customer_id, contracts(reference_code), customers(legal_name, trade_name, first_name, last_name)",
    )
    .eq("company_id", session.company_id)
    .is("invoice_id", null)
    .in("status", ["collected", "pending_settlement", "validated", "settled"])
    .order("collected_at", { ascending: false })
    .limit(100);
  if (error) {
    if (/invoice_id/i.test(error.message ?? "")) return [];
    throw error;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data as any[]) ?? []);
  const userIds = Array.from(
    new Set(rows.map((r) => r.collected_by_user_id).filter(Boolean) as string[]),
  );
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name, display_name")
      .in("user_id", userIds);
    for (const p of ((profiles as { user_id: string; full_name: string | null; display_name: string | null }[] | null) ?? [])) {
      const nice = p.display_name?.trim() || p.full_name?.trim() || p.user_id.slice(0, 8);
      nameMap.set(p.user_id, nice);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    concept: r.concept,
    amount_cents: r.amount_cents,
    method: r.method,
    customer_id: r.customer_id,
    customer_name:
      r.customers?.trade_name ||
      r.customers?.legal_name ||
      [r.customers?.first_name, r.customers?.last_name].filter(Boolean).join(" ") ||
      null,
    contract_id: r.contract_id,
    contract_reference: r.contracts?.reference_code ?? null,
    collected_at: r.collected_at,
    collected_by_name: r.collected_by_user_id
      ? (nameMap.get(r.collected_by_user_id) ?? null)
      : null,
  }));
}
