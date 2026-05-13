"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export type FinancierKind = "renting_strict" | "financing";

export interface FinancierCoefficient {
  id: string;
  financier_id: string;
  term_months: number;
  coefficient: number;
  notes: string | null;
}

export interface Financier {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  notes: string | null;
  kind: FinancierKind;
  residual_pct: number | null;
  reserve_pct: number | null;
  accepts_individual: boolean;
  accepts_autonomo: boolean;
  accepts_company: boolean;
  is_active: boolean;
  sort_order: number;
  // Datos fiscales (Fase 6 — destinatario en factura renting)
  fiscal_legal_name: string | null;
  fiscal_tax_id: string | null;
  fiscal_street: string | null;
  fiscal_postal_code: string | null;
  fiscal_city: string | null;
  fiscal_province: string | null;
  fiscal_country: string;
  fiscal_email: string | null;
  fiscal_phone: string | null;
  fiscal_iban: string | null;
  coefficients: FinancierCoefficient[];
}

const financierSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nombre obligatorio"),
  short_name: z.string().optional().nullable(),
  logo_url: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  kind: z.enum(["renting_strict", "financing"]),
  residual_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  reserve_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  accepts_individual: z.coerce.boolean().default(false),
  accepts_autonomo: z.coerce.boolean().default(true),
  accepts_company: z.coerce.boolean().default(true),
  is_active: z.coerce.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
  fiscal_legal_name: z.string().optional().nullable(),
  fiscal_tax_id: z.string().optional().nullable(),
  fiscal_street: z.string().optional().nullable(),
  fiscal_postal_code: z.string().optional().nullable(),
  fiscal_city: z.string().optional().nullable(),
  fiscal_province: z.string().optional().nullable(),
  fiscal_country: z.string().optional().default("España"),
  fiscal_email: z.string().optional().nullable(),
  fiscal_phone: z.string().optional().nullable(),
  fiscal_iban: z.string().optional().nullable(),
});

const coefSchema = z.object({
  id: z.string().uuid().optional(),
  financier_id: z.string().uuid(),
  term_months: z.coerce.number().int().min(1),
  coefficient: z.coerce.number().positive(),
  notes: z.string().optional().nullable(),
});

async function ensureAdmin() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director") &&
    !session.roles.includes("technical_director")
  )
    throw new Error("Solo admin / director");
  return session;
}

export async function listFinanciers(opts?: {
  only_active?: boolean;
  accepts?: { individual?: boolean; autonomo?: boolean; company?: boolean };
}): Promise<Financier[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const FULL =
    "id, name, short_name, logo_url, notes, kind, residual_pct, reserve_pct, accepts_individual, accepts_autonomo, accepts_company, is_active, sort_order, fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country, fiscal_email, fiscal_phone, fiscal_iban";
  let q = supabase
    .from("financiers")
    .select(FULL)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (opts?.only_active) q = q.eq("is_active", true);
  const { data: fins, error } = await q;
  if (error) {
    // Si la tabla no existe (migración pendiente), devolvemos lista vacía
    // para no romper la página.
    console.warn("[listFinanciers]", error.message);
    return [];
  }
  const list = (fins ?? []) as Financier[];
  if (list.length === 0) return [];

  // Cargar coeficientes en bulk
  const ids = list.map((f) => f.id);
  const { data: coefs } = await supabase
    .from("financier_coefficients")
    .select("id, financier_id, term_months, coefficient, notes")
    .in("financier_id", ids)
    .order("term_months");
  const map = new Map<string, FinancierCoefficient[]>();
  for (const c of (coefs ?? []) as FinancierCoefficient[]) {
    const arr = map.get(c.financier_id) ?? [];
    arr.push(c);
    map.set(c.financier_id, arr);
  }

  let filtered = list.map((f) => ({ ...f, coefficients: map.get(f.id) ?? [] }));
  if (opts?.accepts) {
    filtered = filtered.filter((f) => {
      if (opts.accepts!.individual && !f.accepts_individual) return false;
      if (opts.accepts!.autonomo && !f.accepts_autonomo) return false;
      if (opts.accepts!.company && !f.accepts_company) return false;
      return true;
    });
  }
  return filtered;
}

export async function upsertFinancierAction(input: unknown): Promise<{ id: string }> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = parseOrFriendly(financierSchema, input, "Financiera");
  // renting_strict no admite particulares
  if (parsed.kind === "renting_strict" && parsed.accepts_individual) {
    throw new Error(
      "Una financiera de renting estricto no puede aceptar particulares. Por ley fiscal española, el renting solo es para empresas o autónomos.",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload: Record<string, unknown> = {
    company_id: session.company_id,
    name: parsed.name,
    short_name: parsed.short_name ?? null,
    logo_url: parsed.logo_url ?? null,
    notes: parsed.notes ?? null,
    kind: parsed.kind,
    residual_pct: parsed.residual_pct ?? null,
    reserve_pct: parsed.reserve_pct ?? null,
    accepts_individual: parsed.accepts_individual,
    accepts_autonomo: parsed.accepts_autonomo,
    accepts_company: parsed.accepts_company,
    is_active: parsed.is_active,
    sort_order: parsed.sort_order,
    fiscal_legal_name: parsed.fiscal_legal_name ?? null,
    fiscal_tax_id: parsed.fiscal_tax_id ?? null,
    fiscal_street: parsed.fiscal_street ?? null,
    fiscal_postal_code: parsed.fiscal_postal_code ?? null,
    fiscal_city: parsed.fiscal_city ?? null,
    fiscal_province: parsed.fiscal_province ?? null,
    fiscal_country: parsed.fiscal_country || "España",
    fiscal_email: parsed.fiscal_email ?? null,
    fiscal_phone: parsed.fiscal_phone ?? null,
    fiscal_iban: parsed.fiscal_iban ?? null,
  };
  if (parsed.id) {
    const r = await admin
      .from("financiers")
      .update(payload)
      .eq("id", parsed.id)
      .select("id")
      .single();
    if (r.error) throw new Error(r.error.message);
    revalidatePath("/configuracion/financieras");
    return { id: parsed.id };
  }
  const r = await admin
    .from("financiers")
    .insert({ ...payload, created_by: session.user_id })
    .select("id")
    .single();
  if (r.error) throw new Error(r.error.message);
  revalidatePath("/configuracion/financieras");
  return { id: (r.data as { id: string }).id };
}

export async function deleteFinancierAction(id: string): Promise<void> {
  await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("financiers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/configuracion/financieras");
}

export async function upsertFinancierCoefficientAction(input: unknown): Promise<void> {
  await ensureAdmin();
  const parsed = parseOrFriendly(coefSchema, input, "Coeficiente");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload = {
    financier_id: parsed.financier_id,
    term_months: parsed.term_months,
    coefficient: parsed.coefficient,
    notes: parsed.notes ?? null,
  };
  if (parsed.id) {
    const r = await admin
      .from("financier_coefficients")
      .update(payload)
      .eq("id", parsed.id);
    if (r.error) throw new Error(r.error.message);
  } else {
    const r = await admin
      .from("financier_coefficients")
      .upsert(payload, { onConflict: "financier_id,term_months" });
    if (r.error) throw new Error(r.error.message);
  }
  revalidatePath("/configuracion/financieras");
}

export async function deleteFinancierCoefficientAction(id: string): Promise<void> {
  await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("financier_coefficients").delete().eq("id", id);
  revalidatePath("/configuracion/financieras");
}
