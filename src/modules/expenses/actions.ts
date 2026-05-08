"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { ensureBucket } from "@/shared/lib/supabase/storage-buckets";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import {
  expenseCreateSchema,
  perDiemCreateSchema,
  mileageCreateSchema,
} from "./schemas";
import { isMindeeConfigured, mapMindeeCategoryToOurs, ocrReceiptWithMindee } from "./mindee";

// =============================================================================
// Settings
// =============================================================================

export interface ExpenseSettings {
  per_diem_overnight_cents: number;
  per_diem_no_overnight_cents: number;
  per_diem_eu_overnight_cents: number;
  per_diem_eu_no_overnight_cents: number;
  km_rate_cents: number;
  daily_meal_alert_cents: number;
  approval_threshold_auto_cents: number;
  require_client_link_above_cents: number;
}

const DEFAULT_SETTINGS: ExpenseSettings = {
  per_diem_overnight_cents: 5334,
  per_diem_no_overnight_cents: 2667,
  per_diem_eu_overnight_cents: 9135,
  per_diem_eu_no_overnight_cents: 4808,
  km_rate_cents: 26,
  daily_meal_alert_cents: 5000,
  approval_threshold_auto_cents: 0,
  require_client_link_above_cents: 10000,
};

export async function getExpenseSettings(): Promise<ExpenseSettings> {
  const session = await requireSession();
  if (!session.company_id) return DEFAULT_SETTINGS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("expense_settings")
    .select(
      "per_diem_overnight_cents, per_diem_no_overnight_cents, per_diem_eu_overnight_cents, per_diem_eu_no_overnight_cents, km_rate_cents, daily_meal_alert_cents, approval_threshold_auto_cents, require_client_link_above_cents",
    )
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return data as ExpenseSettings;
}

export async function saveExpenseSettingsAction(input: Partial<ExpenseSettings>) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo admin");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin
    .from("expense_settings")
    .upsert({ company_id: session.company_id, ...input }, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/configuracion/gastos");
}

// =============================================================================
// Categorías
// =============================================================================

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  group_code: string;
  vat_deductible: boolean;
  irpf_exempt_logic: string | null;
  default_max_amount_cents: number | null;
  requires_client_link: boolean;
  display_order: number;
  icon: string | null;
}

async function ensureCategoriesSeeded(companyId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { count } = await admin
    .from("expense_categories")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId);
  if ((count ?? 0) > 0) return;
  await admin.rpc("seed_expense_categories", { p_company: companyId });
}

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  await ensureCategoriesSeeded(session.company_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("expense_categories")
    .select("id, code, name, group_code, vat_deductible, irpf_exempt_logic, default_max_amount_cents, requires_client_link, display_order, icon")
    .eq("company_id", session.company_id)
    .eq("is_active", true)
    .order("display_order");
  return ((data as ExpenseCategory[] | null) ?? []);
}

// =============================================================================
// OCR
// =============================================================================

export interface OcrResultLite {
  total_amount: number | null;
  total_net: number | null;
  total_tax: number | null;
  date: string | null;
  supplier_name: string | null;
  supplier_nif: string | null;
  supplier_address: string | null;
  receipt_number: string | null;
  taxes: Array<{ rate: number; base: number | null; amount: number }>;
  category_code: string | null;
  storage_path: string;
  mime_type: string;
  raw: unknown;
  confidence: number;
}

/**
 * Sube un ticket al bucket "expenses" y opcionalmente lo pasa por OCR.
 * Devuelve los datos extraídos para que el comercial revise antes de
 * persistir el gasto.
 */
export async function uploadAndOcrReceiptAction(formData: FormData): Promise<OcrResultLite> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("Falta el archivo");
  if (file.size === 0) throw new Error("Archivo vacío");
  if (file.size > 8 * 1024 * 1024) throw new Error("Archivo demasiado grande (máx 8MB)");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await ensureBucket(admin, "expenses");

  const ext = (() => {
    const m = /\.(\w{2,5})$/.exec(file.name);
    if (m && m[1]) return m[1].toLowerCase();
    if (file.type === "application/pdf") return "pdf";
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    return "jpg";
  })();
  const path = `${session.company_id}/${session.user_id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const upload = await admin.storage
    .from("expenses")
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (upload.error) throw new Error(`Error subiendo: ${upload.error.message}`);

  // OCR si está configurado (opcional)
  let ocr: OcrResultLite = {
    total_amount: null,
    total_net: null,
    total_tax: null,
    date: null,
    supplier_name: null,
    supplier_nif: null,
    supplier_address: null,
    receipt_number: null,
    taxes: [],
    category_code: null,
    storage_path: path,
    mime_type: file.type,
    raw: null,
    confidence: 0,
  };
  if (isMindeeConfigured()) {
    try {
      const r = await ocrReceiptWithMindee(buffer, file.name, file.type);
      ocr = {
        total_amount: r.total_amount,
        total_net: r.total_net,
        total_tax: r.total_tax,
        date: r.date,
        supplier_name: r.supplier_name,
        supplier_nif: r.supplier_company_registrations[0] ?? null,
        supplier_address: r.supplier_address,
        receipt_number: r.receipt_number,
        taxes: r.taxes.map((t) => ({ rate: t.rate, base: t.base, amount: t.amount })),
        category_code: mapMindeeCategoryToOurs(r.category),
        storage_path: path,
        mime_type: file.type,
        raw: r.raw,
        confidence: r.confidence,
      };
    } catch (e) {
      // No reventamos: OCR es best-effort
      console.error("[expenses ocr]", e);
    }
  }
  return ocr;
}

// =============================================================================
// CRUD gastos
// =============================================================================

export interface ExpenseRow {
  id: string;
  user_id: string;
  user_name: string | null;
  category_code: string | null;
  category_name: string | null;
  merchant_name: string | null;
  issue_date: string | null;
  total_cents: number;
  payment_method: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  receipt_storage_path: string | null;
  notes: string | null;
  approved_at: string | null;
  reimbursed_at: string | null;
  created_at: string;
}

export async function createExpenseAction(input: unknown): Promise<{ id: string }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = parseOrFriendly(expenseCreateSchema, input, "Gasto");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Resolver category_id desde code si solo viene code
  let categoryId = parsed.category_id ?? null;
  if (!categoryId && parsed.category_code) {
    await ensureCategoriesSeeded(session.company_id);
    const { data: cat } = await admin
      .from("expense_categories")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("code", parsed.category_code)
      .maybeSingle();
    categoryId = (cat as { id: string } | null)?.id ?? null;
  }

  const row = {
    company_id: session.company_id,
    user_id: session.user_id,
    category_id: categoryId,
    merchant_name: parsed.merchant_name ?? null,
    merchant_nif: parsed.merchant_nif ?? null,
    merchant_address: parsed.merchant_address ?? null,
    issue_date: parsed.issue_date ?? null,
    document_type: parsed.document_type,
    document_number: parsed.document_number ?? null,
    total_cents: parsed.total_cents,
    base_cents: parsed.base_cents ?? null,
    vat_cents: parsed.vat_cents ?? null,
    vat_breakdown: parsed.vat_breakdown ?? null,
    currency: parsed.currency,
    payment_method: parsed.payment_method,
    corp_card_last4: parsed.corp_card_last4 ?? null,
    customer_id: parsed.customer_id ?? null,
    contract_id: parsed.contract_id ?? null,
    installation_id: parsed.installation_id ?? null,
    notes: parsed.notes ?? null,
    receipt_storage_path: parsed.receipt_storage_path ?? null,
    receipt_mime: parsed.receipt_mime ?? null,
    ocr_provider: parsed.ocr_provider ?? null,
    ocr_raw: parsed.ocr_raw ?? null,
    ocr_confidence: parsed.ocr_confidence ?? null,
    status: "submitted",
    submitted_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("expenses").insert(row).select("id").single();
  if (error) throw new Error(error.message);

  revalidatePath("/gastos");
  return { id: (data as { id: string }).id };
}

export async function listExpenses(filters?: {
  status?: string;
  user_id?: string;
  category_code?: string;
  fromDate?: string;
  toDate?: string;
  customer_id?: string;
}): Promise<ExpenseRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);

  let q = admin
    .from("expenses")
    .select(
      "id, user_id, category_id, merchant_name, issue_date, total_cents, payment_method, status, customer_id, receipt_storage_path, notes, approved_at, reimbursed_at, created_at, expense_categories(code, name), customers(legal_name, trade_name, first_name, last_name)",
    )
    .eq("company_id", session.company_id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (visibleUserIds) q = q.in("user_id", visibleUserIds);
  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.user_id) q = q.eq("user_id", filters.user_id);
  if (filters?.customer_id) q = q.eq("customer_id", filters.customer_id);
  if (filters?.fromDate) q = q.gte("issue_date", filters.fromDate);
  if (filters?.toDate) q = q.lte("issue_date", filters.toDate);

  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseRows = ((data as any[]) ?? []);

  // Resolver nombres del comercial via user_profiles (auth.users → user_profiles.user_id)
  const userIds = Array.from(new Set(baseRows.map((r) => r.user_id).filter(Boolean) as string[]));
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name, display_name")
      .in("user_id", userIds);
    for (const p of ((profiles as { user_id: string; full_name: string | null; display_name: string | null }[] | null) ?? [])) {
      const nice = p.display_name?.trim() || p.full_name?.trim() || "";
      nameMap.set(p.user_id, nice);
    }
  }

  const rows = baseRows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: nameMap.get(r.user_id) ?? null,
    category_code: r.expense_categories?.code ?? null,
    category_name: r.expense_categories?.name ?? null,
    merchant_name: r.merchant_name,
    issue_date: r.issue_date,
    total_cents: r.total_cents,
    payment_method: r.payment_method,
    status: r.status,
    customer_id: r.customer_id,
    customer_name:
      r.customers?.trade_name ||
      r.customers?.legal_name ||
      [r.customers?.first_name, r.customers?.last_name].filter(Boolean).join(" ") ||
      null,
    receipt_storage_path: r.receipt_storage_path,
    notes: r.notes,
    approved_at: r.approved_at,
    reimbursed_at: r.reimbursed_at,
    created_at: r.created_at,
  })) as ExpenseRow[];
  if (filters?.category_code) {
    return rows.filter((r) => r.category_code === filters.category_code);
  }
  return rows;
}

// =============================================================================
// Workflow: aprobar / rechazar / liquidar
// =============================================================================

function isApprover(session: { is_superadmin: boolean; roles: string[] }): boolean {
  return (
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director")
  );
}

export async function approveExpenseAction(id: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!isApprover(session)) throw new Error("Solo admin/director");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: row } = await admin
    .from("expenses")
    .select("id, status, payment_method, company_id")
    .eq("id", id)
    .maybeSingle();
  const e = row as
    | { id: string; status: string; payment_method: string; company_id: string }
    | null;
  if (!e) throw new Error("Gasto no encontrado");
  if (e.company_id !== session.company_id) throw new Error("Otra empresa");
  // Si era con tarjeta de empresa, aprobar significa "validado y final".
  // Si era con dinero personal, queda "approved" pendiente de liquidar.
  const newStatus = e.payment_method === "corp_card" ? "reconciled" : "approved";
  const r = await admin
    .from("expenses")
    .update({
      status: newStatus,
      approved_by_user_id: session.user_id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  revalidatePath("/gastos");
  revalidatePath(`/gastos/${id}`);
}

export async function rejectExpenseAction(id: string, reason: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!isApprover(session)) throw new Error("Solo admin/director");
  if (!reason.trim()) throw new Error("Indica el motivo del rechazo");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("expenses")
    .update({
      status: "rejected",
      rejection_reason: reason,
      approved_by_user_id: session.user_id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("company_id", session.company_id);
  if (r.error) throw new Error(r.error.message);
  revalidatePath("/gastos");
  revalidatePath(`/gastos/${id}`);
}

export async function reimburseExpenseAction(
  id: string,
  input: { amount_cents: number; bank_ref?: string; notes?: string },
) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!isApprover(session)) throw new Error("Solo admin/director");
  if (input.amount_cents <= 0) throw new Error("Importe inválido");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: row } = await admin
    .from("expenses")
    .select("id, status, payment_method, total_cents, company_id, user_id")
    .eq("id", id)
    .maybeSingle();
  const e = row as
    | {
        id: string;
        status: string;
        payment_method: string;
        total_cents: number;
        company_id: string;
        user_id: string;
      }
    | null;
  if (!e) throw new Error("Gasto no encontrado");
  if (e.company_id !== session.company_id) throw new Error("Otra empresa");
  if (e.payment_method === "corp_card") {
    throw new Error("Gasto con tarjeta empresa no requiere liquidación");
  }
  if (e.status !== "approved") {
    throw new Error("El gasto debe estar aprobado antes de liquidar");
  }
  const r = await admin
    .from("expenses")
    .update({
      status: "reimbursed",
      reimbursed_at: new Date().toISOString(),
      reimbursed_amount_cents: input.amount_cents,
      bank_transaction_ref: input.bank_ref ?? null,
      reimbursement_notes: input.notes ?? null,
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  // Notificación al comercial
  try {
    await admin.from("notifications").insert({
      company_id: session.company_id,
      recipient_user_id: e.user_id,
      kind: "expense.reimbursed",
      severity: "success",
      title: "Gasto liquidado",
      body: `Te hemos reembolsado ${(input.amount_cents / 100).toFixed(2)} €`,
      subject_type: "expense",
      subject_id: id,
      action_url: `/gastos/${id}`,
    });
  } catch {
    /* no-op */
  }
  revalidatePath("/gastos");
  revalidatePath(`/gastos/${id}`);
}

export async function getExpenseReceiptUrl(expenseId: string): Promise<string | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: row } = await admin
    .from("expenses")
    .select("receipt_storage_path, company_id")
    .eq("id", expenseId)
    .maybeSingle();
  const e = row as { receipt_storage_path: string | null; company_id: string } | null;
  if (!e || !e.receipt_storage_path) return null;
  if (e.company_id !== session.company_id) return null;
  const { data: signed } = await admin.storage
    .from("expenses")
    .createSignedUrl(e.receipt_storage_path, 60 * 10); // 10 min
  return (signed as { signedUrl: string } | null)?.signedUrl ?? null;
}

// =============================================================================
// Per-diem (dietas)
// =============================================================================

export async function createPerDiemAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = parseOrFriendly(perDiemCreateSchema, input, "Dieta");
  const settings = await getExpenseSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let exemptCents: number;
  if (parsed.scope === "national") {
    exemptCents = parsed.with_overnight
      ? settings.per_diem_overnight_cents
      : settings.per_diem_no_overnight_cents;
  } else {
    exemptCents = parsed.with_overnight
      ? settings.per_diem_eu_overnight_cents
      : settings.per_diem_eu_no_overnight_cents;
  }
  const { error } = await admin.from("expense_per_diems").insert({
    company_id: session.company_id,
    user_id: session.user_id,
    date: parsed.date,
    with_overnight: parsed.with_overnight,
    scope: parsed.scope,
    destination: parsed.destination ?? null,
    customer_id: parsed.customer_id ?? null,
    trip_purpose: parsed.trip_purpose ?? null,
    notes: parsed.notes ?? null,
    daily_amount_exempt_cents: exemptCents,
    status: "submitted",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/gastos");
}

// =============================================================================
// Kilometraje
// =============================================================================

export async function createMileageAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = parseOrFriendly(mileageCreateSchema, input, "Kilometraje");
  const settings = await getExpenseSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const total_cents = parsed.km * settings.km_rate_cents;
  const { error } = await admin.from("expense_mileage").insert({
    company_id: session.company_id,
    user_id: session.user_id,
    date: parsed.date,
    origin: parsed.origin ?? null,
    destination: parsed.destination ?? null,
    km: parsed.km,
    rate_cents_per_km: settings.km_rate_cents,
    total_cents,
    customer_id: parsed.customer_id ?? null,
    contract_id: parsed.contract_id ?? null,
    installation_id: parsed.installation_id ?? null,
    vehicle_plate: parsed.vehicle_plate ?? null,
    notes: parsed.notes ?? null,
    status: "submitted",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/gastos");
}

// =============================================================================
// Resumen para KPIs
// =============================================================================

export interface ExpenseSummary {
  pending_count: number;
  pending_amount_cents: number;
  approved_pending_reimbursement_cents: number;
  reimbursed_this_month_cents: number;
}

export async function getExpenseSummary(): Promise<ExpenseSummary> {
  const session = await requireSession();
  if (!session.company_id) {
    return {
      pending_count: 0,
      pending_amount_cents: 0,
      approved_pending_reimbursement_cents: 0,
      reimbursed_this_month_cents: 0,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);

  let q = admin
    .from("expenses")
    .select("status, payment_method, total_cents, reimbursed_amount_cents, reimbursed_at, user_id")
    .eq("company_id", session.company_id);
  if (visibleUserIds) q = q.in("user_id", visibleUserIds);
  const { data } = await q;
  const rows = ((data as Array<{
    status: string;
    payment_method: string;
    total_cents: number;
    reimbursed_amount_cents: number | null;
    reimbursed_at: string | null;
  }> | null) ?? []);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  return {
    pending_count: rows.filter((r) => r.status === "submitted").length,
    pending_amount_cents: rows
      .filter((r) => r.status === "submitted")
      .reduce((s, r) => s + r.total_cents, 0),
    approved_pending_reimbursement_cents: rows
      .filter((r) => r.status === "approved" && r.payment_method !== "corp_card")
      .reduce((s, r) => s + r.total_cents, 0),
    reimbursed_this_month_cents: rows
      .filter(
        (r) =>
          r.status === "reimbursed" &&
          r.reimbursed_at &&
          new Date(r.reimbursed_at) >= monthStart,
      )
      .reduce((s, r) => s + (r.reimbursed_amount_cents ?? 0), 0),
  };
}
