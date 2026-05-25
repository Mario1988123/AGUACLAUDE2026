"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export type Tier = "lite" | "medium" | "premium";

export interface MaintenancePlan {
  id: string;
  tier: Tier;
  name: string;
  monthly_cents: number;
  visits_per_year: number | null;
  parts_discount_percent: number;
  spare_equipment_included: boolean;
  description: string | null;
  is_active: boolean;
}

export interface MaintenanceContractRow {
  id: string;
  reference_code: string | null;
  status: string;
  customer_id: string;
  customer_name: string;
  tier_snapshot: string;
  monthly_cents_snapshot: number;
  visits_per_year_snapshot: number | null;
  starts_on: string;
  ends_on: string | null;
  created_at: string;
}

export async function listMaintenancePlans(): Promise<MaintenancePlan[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("maintenance_plans")
    .select(
      "id, tier, name, monthly_cents, visits_per_year, parts_discount_percent, spare_equipment_included, description, is_active",
    )
    .eq("company_id", session.company_id)
    .order("monthly_cents");
  return ((data ?? []) as MaintenancePlan[]).filter((p) => p.is_active);
}

export async function listMaintenanceContracts(): Promise<MaintenanceContractRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("maintenance_contracts")
    .select(
      "id, reference_code, status, customer_id, tier_snapshot, monthly_cents_snapshot, visits_per_year_snapshot, starts_on, ends_on, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Array<Omit<MaintenanceContractRow, "customer_name">>;
  if (rows.length === 0) return [];
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)));
  const { data: cs } = await supabase
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name")
    .in("id", customerIds);
  const map = new Map(
    ((cs ?? []) as Array<{
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>).map((c) => [
      c.id,
      c.party_kind === "company"
        ? c.trade_name || c.legal_name || "Sin nombre"
        : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
    ]),
  );
  return rows.map((r) => ({ ...r, customer_name: map.get(r.customer_id) ?? "Cliente" }));
}

/**
 * Crea un contrato de mantenimiento. Toma snapshot del plan, IBAN
 * principal del cliente, genera reference_code "M-YYYY-NNNN".
 */
export async function createMaintenanceContractAction(input: {
  customer_id: string;
  plan_id: string;
  source_installation_id?: string | null;
  source_contract_id?: string | null;
  starts_on?: string;
  ends_on?: string | null;
  /**
   * Equipo concreto al que va asignado el contrato. Regla 2026-05-25:
   * el contrato es por equipo, no por cliente. Si se omite, queda como
   * contrato legacy a nivel cliente (cubre todos los equipos).
   */
  customer_equipment_id?: string | null;
}): Promise<{ id: string }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Snapshot del plan
  const { data: plan } = await admin
    .from("maintenance_plans")
    .select(
      "id, tier, monthly_cents, visits_per_year, parts_discount_percent, spare_equipment_included",
    )
    .eq("id", input.plan_id)
    .eq("company_id", session.company_id)
    .single();
  if (!plan) throw new Error("Plan no encontrado");
  const p = plan as {
    id: string;
    tier: string;
    monthly_cents: number;
    visits_per_year: number | null;
    parts_discount_percent: number;
    spare_equipment_included: boolean;
  };

  // IBAN principal del cliente (puede ser ES00 placeholder)
  const { data: bank } = await admin
    .from("customer_bank_accounts")
    .select("iban, account_holder_name")
    .eq("customer_id", input.customer_id)
    .eq("is_primary", true)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const b = bank as { iban: string | null; account_holder_name: string | null } | null;

  // reference_code M-YYYY-NNNN
  const year = new Date().getFullYear();
  const yearPrefix = `M-${year}-`;
  const { data: last } = await admin
    .from("maintenance_contracts")
    .select("reference_code")
    .eq("company_id", session.company_id)
    .like("reference_code", `${yearPrefix}%`)
    .order("reference_code", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextNum = 1;
  const lastCode = (last as { reference_code: string | null } | null)?.reference_code;
  if (lastCode) {
    const m = lastCode.match(/-(\d+)$/);
    if (m) nextNum = parseInt(m[1]!, 10) + 1;
  }
  const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

  const { data: created, error } = await admin
    .from("maintenance_contracts")
    .insert({
      company_id: session.company_id,
      customer_id: input.customer_id,
      customer_equipment_id: input.customer_equipment_id ?? null,
      plan_id: p.id,
      source_installation_id: input.source_installation_id ?? null,
      source_contract_id: input.source_contract_id ?? null,
      tier_snapshot: p.tier,
      monthly_cents_snapshot: p.monthly_cents,
      visits_per_year_snapshot: p.visits_per_year,
      parts_discount_snapshot: p.parts_discount_percent,
      spare_equipment_snapshot: p.spare_equipment_included,
      iban_snapshot: b?.iban ?? null,
      iban_holder_snapshot: b?.account_holder_name ?? null,
      status: "active",
      reference_code: referenceCode,
      starts_on: input.starts_on ?? new Date().toISOString().slice(0, 10),
      ends_on: input.ends_on ?? null,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "maintenance_contract",
    subject_id: (created as { id: string }).id,
    kind: "maintenance_contract.created",
    payload: { tier: p.tier, monthly_cents: p.monthly_cents },
    actor_user_id: session.user_id,
  });

  revalidatePath("/mantenimientos");
  if (input.customer_id) revalidatePath(`/clientes/${input.customer_id}`);
  return { id: (created as { id: string }).id };
}

/**
 * Genera la remesa mensual: por cada maintenance_contract activo crea
 * una factura del mes en curso (idempotente: si ya existe la factura
 * de YYYY-MM no se duplica).
 */
export async function generateMonthlyMaintenanceInvoicesAction(): Promise<{
  created: number;
  skipped: number;
}> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin")
  ) {
    throw new Error("Solo el admin de empresa puede lanzar la remesa");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const issueDate = now.toISOString().slice(0, 10);
  // Fin de mes
  const due = new Date(year, month, 0);
  const dueDate = due.toISOString().slice(0, 10);

  const { data: contracts } = await admin
    .from("maintenance_contracts")
    .select(
      "id, customer_id, tier_snapshot, monthly_cents_snapshot, reference_code",
    )
    .eq("company_id", session.company_id)
    .eq("status", "active")
    .is("deleted_at", null);

  const list = (contracts ?? []) as Array<{
    id: string;
    customer_id: string;
    tier_snapshot: string;
    monthly_cents_snapshot: number;
    reference_code: string | null;
  }>;

  // IVA por defecto del mantenimiento. España estándar 21%.
  const TAX_RATE = 21;
  // Usamos el createInvoiceAction canónico que asigna series_id, number,
  // fiscal_year, full_reference, snapshots fiscales, líneas, etc. El
  // INSERT directo anterior fallaba silenciosamente porque invoices
  // tiene varias columnas NOT NULL que no estábamos rellenando, y
  // supabase-js NO lanza throw — devuelve {error}. Por eso el contador
  // decía "created" pero la BD no tenía nada.
  const { createInvoiceAction } = await import("@/modules/invoices/actions");

  const errors: Array<{ contract: string; error: string }> = [];
  let created = 0;
  let skipped = 0;
  for (const mc of list) {
    const description = `Mantenimiento ${mc.tier_snapshot.toUpperCase()} ${monthKey}${mc.reference_code ? ` · ${mc.reference_code}` : ""}`;
    // Idempotencia: ya existe factura del mes para ese cliente con
    // descripción que contiene el reference_code del maintenance_contract.
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
    let alreadyExists = false;
    try {
      const ref = mc.reference_code ?? mc.id.slice(0, 8);
      const { data: existing } = await admin
        .from("invoices")
        .select("id, invoice_lines!inner(description)")
        .eq("company_id", session.company_id)
        .eq("customer_id", mc.customer_id)
        .gte("issue_date", monthStart)
        .lte("issue_date", monthEnd)
        .ilike("invoice_lines.description", `%${ref}%`)
        .limit(1)
        .maybeSingle();
      alreadyExists = !!existing;
    } catch {
      /* si la query falla intentamos igualmente la creación */
    }
    if (alreadyExists) {
      skipped += 1;
      continue;
    }
    try {
      await createInvoiceAction({
        customer_id: mc.customer_id,
        kind: "invoice",
        due_date: dueDate,
        notes: `Remesa mensual ${monthKey}. maintenance_contract ${mc.id}`,
        lines: [
          {
            description,
            quantity: 1,
            // monthly_cents_snapshot es importe SIN IVA (subtotal). El
            // createInvoiceAction le aplica el tax_rate_percent encima.
            unit_price_cents: mc.monthly_cents_snapshot,
            discount_percent: 0,
            tax_rate_percent: TAX_RATE,
          },
        ],
      });
      created += 1;
    } catch (e) {
      errors.push({
        contract: mc.reference_code ?? mc.id.slice(0, 8),
        error: e instanceof Error ? e.message : "Error",
      });
      skipped += 1;
    }
  }
  if (errors.length > 0) {
    console.error("[generateMonthlyMaintenanceInvoices] errores:", errors);
  }

  // issueDate ya no se usa directamente (createInvoiceAction usa current_date)
  void issueDate;

  revalidatePath("/facturas");
  revalidatePath("/mantenimientos");
  return { created, skipped };
}

/**
 * Cancela un contrato de mantenimiento.
 */
export async function cancelMaintenanceContractAction(
  id: string,
  reason: string | null,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("maintenance_contracts")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason,
    })
    .eq("id", id);
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "maintenance_contract",
    subject_id: id,
    kind: "maintenance_contract.cancelled",
    payload: { reason },
    actor_user_id: session.user_id,
  });

  // Notificar a admin/director técnico de la cancelación
  try {
    const { notifyByRoles } = await import("@/modules/notifications/notifier");
    await notifyByRoles(
      session.company_id,
      ["company_admin", "technical_director", "commercial_director"],
      {
        kind: "maintenance_contract.cancelled",
        severity: "warning",
        title: "Contrato de mantenimiento cancelado",
        body: reason ?? "Sin motivo indicado",
        subject_type: "contract",
        subject_id: id,
        action_url: `/mantenimientos`,
      },
    );
  } catch {
    /* no-op */
  }

  revalidatePath("/mantenimientos");
}

// =================== Safe wrappers ===================

export async function createMaintenanceContractSafeAction(input: {
  customer_id: string;
  plan_id: string;
  source_installation_id?: string | null;
  source_contract_id?: string | null;
  customer_equipment_id?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createMaintenanceContractAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Devuelve mapa equipment_id → true para los equipos del cliente que
 * ya tienen un contrato de mantenimiento ACTIVO. Permite a la UI ocultar
 * el botón "Ofrecer contrato" en los equipos ya cubiertos.
 */
export async function getEquipmentsWithActiveMaintenanceContract(
  customerId: string,
): Promise<Set<string>> {
  try {
    await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("maintenance_contracts")
      .select("customer_equipment_id")
      .eq("customer_id", customerId)
      .eq("status", "active")
      .not("customer_equipment_id", "is", null);
    const out = new Set<string>();
    for (const r of (data ?? []) as Array<{ customer_equipment_id: string }>) {
      out.add(r.customer_equipment_id);
    }
    return out;
  } catch {
    return new Set();
  }
}

export async function generateMonthlyMaintenanceInvoicesSafeAction(): Promise<
  { ok: true; created: number; skipped: number } | { ok: false; error: string }
> {
  try {
    const r = await generateMonthlyMaintenanceInvoicesAction();
    return { ok: true, created: r.created, skipped: r.skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
