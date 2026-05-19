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
  limit?: number;
  offset?: number;
}): Promise<WalletEntryRow[]> {
  const session = await requireSession();
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const limit = Math.min(500, filters?.limit ?? 50);
  const offset = Math.max(0, filters?.offset ?? 0);
  // Defensa-en-profundidad: la columna invoice_id se añadió en
  // 20260511100000. Si la migración no se ha aplicado, hacemos fallback
  // sin esa columna en lugar de reventar la página.
  let query = supabase
    .from("wallet_entries")
    .select(
      "id, concept, amount_cents, method, status, collected_by_user_id, collected_at, validated_at, contract_id, customer_id, invoice_id, created_at, contracts(reference_code), customers(legal_name, trade_name, first_name, last_name), invoices(full_reference, status)",
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
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
      .range(offset, offset + limit - 1);
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

/**
 * Resumen de wallet. Pendientes son acumulado (lo que falta cobrar es
 * pendiente, da igual cuándo se generó). Settled/validated se filtran
 * por mes (los importes finales tienen sentido medirlos mensualmente —
 * "este mes el comercial ha liquidado X, ha confirmado en banco Y").
 *
 * Si no se pasa year/month, usa el mes en curso.
 */
export async function getWalletSummary(input?: { year?: number; month?: number }) {
  const session = await requireSession();
  const now = new Date();
  const year = input?.year ?? now.getFullYear();
  const month = input?.month ?? now.getMonth() + 1; // 1-12
  const monthStart = new Date(year, month - 1, 1).toISOString();
  const monthEnd = new Date(year, month, 1).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("wallet_entries")
    .select(
      "status, amount_cents, collected_by_user_id, settled_at, validated_at, created_at",
    );
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    status: string;
    amount_cents: number;
    collected_by_user_id: string | null;
    settled_at: string | null;
    validated_at: string | null;
    created_at: string;
  }>;
  const isAllSeer =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  const filtered = isAllSeer
    ? rows
    : rows.filter((r) => r.collected_by_user_id === session.user_id);

  // Pendientes: acumulado (no se filtran por fecha)
  const sumStatus = (st: string) =>
    filtered.filter((r) => r.status === st).reduce((s, r) => s + r.amount_cents, 0);

  // Liquidado del mes: status=settled cuyo settled_at cae en el mes
  const settledMonth = filtered
    .filter(
      (r) =>
        r.status === "settled" &&
        r.settled_at &&
        r.settled_at >= monthStart &&
        r.settled_at < monthEnd,
    )
    .reduce((s, r) => s + r.amount_cents, 0);
  // Validado del mes: status=validated cuyo validated_at cae en el mes
  const validatedMonth = filtered
    .filter(
      (r) =>
        r.status === "validated" &&
        r.validated_at &&
        r.validated_at >= monthStart &&
        r.validated_at < monthEnd,
    )
    .reduce((s, r) => s + r.amount_cents, 0);

  return {
    pending_cents: sumStatus("pending"),
    collected_cents: sumStatus("collected"),
    pending_settlement_cents: sumStatus("pending_settlement"),
    settled_month_cents: settledMonth,
    validated_month_cents: validatedMonth,
    period_year: year,
    period_month: month,
  };
}

/**
 * Histórico mensual del año dado. Para que el admin vea evolución.
 * Devuelve 12 entradas (enero a diciembre) con el total settled y
 * validated cerrado en cada mes.
 */
export interface WalletMonthlyRow {
  month: number;
  settled_cents: number;
  validated_cents: number;
  total_final_cents: number;
}

export async function getWalletYearlyHistory(input?: {
  year?: number;
  user_id?: string;
}): Promise<WalletMonthlyRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!isAdmin) return [];

  const year = input?.year ?? new Date().getFullYear();
  const yearStart = new Date(year, 0, 1).toISOString();
  const yearEnd = new Date(year + 1, 0, 1).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("wallet_entries")
    .select("status, amount_cents, settled_at, validated_at, collected_by_user_id")
    .eq("company_id", session.company_id);
  if (input?.user_id) q = q.eq("collected_by_user_id", input.user_id);
  const { data } = await q;
  const rows = ((data as Array<{
    status: string;
    amount_cents: number;
    settled_at: string | null;
    validated_at: string | null;
  }> | null) ?? []);

  const monthly: WalletMonthlyRow[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    settled_cents: 0,
    validated_cents: 0,
    total_final_cents: 0,
  }));

  for (const r of rows) {
    if (r.status === "settled" && r.settled_at && r.settled_at >= yearStart && r.settled_at < yearEnd) {
      const m = new Date(r.settled_at).getMonth();
      monthly[m]!.settled_cents += r.amount_cents;
      monthly[m]!.total_final_cents += r.amount_cents;
    } else if (
      r.status === "validated" &&
      r.validated_at &&
      r.validated_at >= yearStart &&
      r.validated_at < yearEnd
    ) {
      const m = new Date(r.validated_at).getMonth();
      monthly[m]!.validated_cents += r.amount_cents;
      monthly[m]!.total_final_cents += r.amount_cents;
    }
  }
  return monthly;
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

  // Idempotencia (decisión 2026-05-20): si en los últimos 60 segundos
  // se creó un wallet_entry con mismo customer_id + concept +
  // amount_cents + method, asumimos doble click / replay y NO duplicamos.
  // Ventana corta para no bloquear cobros legítimos repetidos.
  try {
    const recentThreshold = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: dup } = await supabase
      .from("wallet_entries")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("customer_id", parsed.customer_id || null)
      .eq("concept", parsed.concept)
      .eq("amount_cents", parsed.amount_cents)
      .eq("method", parsed.method)
      .gte("created_at", recentThreshold)
      .limit(1)
      .maybeSingle();
    if (dup) {
      console.warn(
        `[wallet/create] duplicate detected within 60s, skip insert (id=${(dup as { id: string }).id})`,
      );
      revalidatePath("/wallet");
      return;
    }
  } catch {
    /* fail-soft: si SELECT falla, intentamos insertar igual */
  }

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
    .select(
      "id, contract_id, contract_payment_id, collected_by_user_id, concept, amount_cents, method, status",
    )
    .eq("id", id)
    .maybeSingle();
  const e = entry as
    | {
        id: string;
        contract_id: string | null;
        contract_payment_id: string | null;
        collected_by_user_id: string | null;
        concept: string;
        amount_cents: number;
        method: string;
        status: string;
      }
    | null;
  if (!e) throw new Error("Entrada no encontrada");
  // Guard: solo se valida desde collected / pending_settlement. Esto evita
  // doble validación si el admin pulsa dos veces.
  if (
    e.status !== "collected" &&
    e.status !== "pending_settlement"
  ) {
    throw new Error(
      `No se puede validar este cobro (estado actual: ${e.status}). Solo se valida desde 'cobrado' o 'pendiente de liquidación'.`,
    );
  }
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

  // PROPAGAR al contract_payment vinculado. El estado válido en
  // contract_payments es 'validated' tanto para cash como para banco
  // (no usa el 'settled' interno del wallet). Sin esta propagación la
  // cartera de alquileres (que mira contract_payments) seguía mostrando
  // "Pendiente" aunque el wallet ya estuviera validado en banco.
  //
  // Si contract_payment_id NO está poblado pero sí hay contract_id, se
  // intenta vincular por mejor match: contract_payment del mismo contrato
  // con mismo importe y status pending/collected_pending_validation, el
  // más antiguo. Esto recoge el caso de wallets pre-existentes a la
  // migración de wallet_entries.contract_payment_id.
  let resolvedContractPaymentId: string | null = e.contract_payment_id;
  if (!resolvedContractPaymentId && e.contract_id) {
    try {
      const { data: candidates } = await admin
        .from("contract_payments")
        .select("id, amount_cents, status, created_at")
        .eq("contract_id", e.contract_id)
        .eq("amount_cents", e.amount_cents)
        .in("status", ["pending", "collected_pending_validation"])
        .order("created_at", { ascending: true })
        .limit(1);
      const cand = (candidates as Array<{ id: string }> | null)?.[0];
      if (cand) {
        resolvedContractPaymentId = cand.id;
        await admin
          .from("wallet_entries")
          .update({ contract_payment_id: resolvedContractPaymentId })
          .eq("id", id);
      }
    } catch (err) {
      console.error("[validateWalletEntry] backfill cp_id falló:", err);
    }
  }
  if (resolvedContractPaymentId) {
    try {
      await admin
        .from("contract_payments")
        .update({
          status: "validated",
          collected_at: new Date().toISOString(),
          collected_by_user_id: e.collected_by_user_id ?? session.user_id,
          validated_at: new Date().toISOString(),
          validated_by_user_id: session.user_id,
          wallet_entry_id: id,
        })
        .eq("id", resolvedContractPaymentId);
    } catch (err) {
      console.error(
        "[validateWalletEntry] sync contract_payment falló:",
        err,
      );
    }
  }
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
  revalidatePath("/contratos/alquileres");
  if (e.contract_id) revalidatePath(`/contratos/${e.contract_id}`);

  // Auto-resolver notificaciones del wallet_entry (ya validado) y del
  // contract (si lo tiene). Fail-soft.
  try {
    const { autoResolveNotificationsForSubject } = await import(
      "@/modules/notifications/subject-actions"
    );
    await autoResolveNotificationsForSubject(
      "wallet_entry",
      id,
      finalStatus === "settled" ? "Pago liquidado" : "Pago validado",
    );
    if (e.contract_id) {
      await autoResolveNotificationsForSubject(
        "contract_payment_pending",
        e.contract_id,
        "Pago del contrato validado",
      );
    }
  } catch {
    /* no-op */
  }
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

    // Guard: AEAT exige domicilio fiscal. Si el cliente no tiene dirección
    // ni tax_id, la factura quedaría inválida. Validar antes de generarla.
    const { data: cust } = await admin
      .from("customers")
      .select("tax_id, legal_name, trade_name, first_name, last_name, party_kind")
      .eq("id", w.customer_id)
      .maybeSingle();
    const cu = cust as
      | {
          tax_id: string | null;
          legal_name: string | null;
          trade_name: string | null;
          first_name: string | null;
          last_name: string | null;
          party_kind: "individual" | "company";
        }
      | null;
    if (!cu?.tax_id) {
      return {
        ok: false,
        error:
          "El cliente no tiene DNI/CIF. Complétalo en su ficha antes de facturar.",
      };
    }
    const { count: addrCount } = await admin
      .from("addresses")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", w.customer_id);
    if ((addrCount ?? 0) === 0) {
      return {
        ok: false,
        error:
          "El cliente no tiene dirección. Añade una dirección fiscal antes de facturar.",
      };
    }
    if (!["collected", "pending_settlement", "validated", "settled"].includes(w.status)) {
      return {
        ok: false,
        error: `Solo se factura un cobro confirmado (estado actual: ${w.status})`,
      };
    }

    // IVA configurable desde fiscal settings (antes hardcoded 21%).
    const { getFiscalSettings } = await import("@/modules/config/fiscal/actions");
    const fiscal = await getFiscalSettings();
    const ivaPercent = fiscal.invoice_default_iva ?? 21;
    const totalCents = w.amount_cents;
    const baseCents = Math.round(totalCents / (1 + ivaPercent / 100));

    const { createInvoiceAction } = await import("@/modules/invoices/actions");
    const invoiceId = await createInvoiceAction({
      customer_id: w.customer_id,
      contract_id: w.contract_id ?? null,
      kind: "invoice",
      notes: w.concept,
      lines: [
        {
          description: w.concept,
          quantity: 1,
          unit_price_cents: baseCents,
          discount_percent: 0,
          tax_rate_percent: ivaPercent,
        },
      ],
    });

    // Vincular wallet → factura
    await admin
      .from("wallet_entries")
      .update({ invoice_id: invoiceId })
      .eq("id", w.id);

    // Registrar el cobro como invoice_payment + marcar factura pagada
    // (el wallet_entry ya estaba en collected/validated → la factura nace
    // pagada porque corresponde a un cobro real).
    try {
      await admin.from("invoice_payments").insert({
        company_id: session.company_id,
        invoice_id: invoiceId,
        wallet_entry_id: w.id,
        amount_cents: w.amount_cents,
        created_by: session.user_id,
      });
      await admin
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", invoiceId);
    } catch (e) {
      console.error("[createInvoiceFromWallet] paid mark failed:", e);
      // No bloqueante: factura existe, solo falta marcar paid.
    }

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
