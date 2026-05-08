"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  type CalcConfig,
  type CalcInputs,
  type CalcResult,
  computeSavings,
} from "./calc";

const DEFAULT_CONFIG: CalcConfig = {
  osmosis_annual_cost_cents: 15000,
  liters_per_person_day_home: 2.0,
  liters_per_person_day_office: 0.5,
  co2_per_bottle_kg: 0.082,
  plastic_per_bottle_kg: 0.025,
  default_bottle_size_liters: 1.5,
  service_garrafa_size_liters: 20,
  service_cycles_per_year: 13,
  recommended_dispensers_threshold: 15,
};

// =============================================================================
// Config
// =============================================================================

export async function getSavingsConfig(): Promise<CalcConfig> {
  const session = await requireSession();
  if (!session.company_id) return DEFAULT_CONFIG;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("savings_calculator_config")
    .select("*")
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!data) {
    // Seed por primera vez
    try {
      await admin.rpc("seed_savings_calculator", { p_company: session.company_id });
      const { data: d2 } = await admin
        .from("savings_calculator_config")
        .select("*")
        .eq("company_id", session.company_id)
        .maybeSingle();
      if (d2) return d2 as CalcConfig;
    } catch {
      /* fail-soft */
    }
    return DEFAULT_CONFIG;
  }
  return data as CalcConfig;
}

export async function saveSavingsConfigAction(input: Partial<CalcConfig>) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo admin");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin
    .from("savings_calculator_config")
    .upsert({ company_id: session.company_id, ...input }, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/configuracion/calculadora-ahorro");
}

// =============================================================================
// Marcas
// =============================================================================

export interface SavingsBrand {
  id: string;
  name: string;
  kind: "supermarket" | "service";
  price_per_liter_cents: number | null;
  price_source: "manual" | "scraper_mercadona" | "scraper_carrefour" | null;
  scrape_query: string | null;
  last_scraped_at: string | null;
  last_scrape_failed_at: string | null;
  consecutive_failures: number;
  prices_by_garrafas: Record<string, number> | null;
  is_active: boolean;
  display_order: number;
}

export async function listSavingsBrands(): Promise<SavingsBrand[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Asegurarse de que las marcas están sembradas
  const { count } = await admin
    .from("savings_water_brands")
    .select("id", { count: "exact", head: true })
    .eq("company_id", session.company_id);
  if ((count ?? 0) === 0) {
    try {
      await admin.rpc("seed_savings_calculator", { p_company: session.company_id });
    } catch {
      /* fail-soft */
    }
  }

  const { data } = await admin
    .from("savings_water_brands")
    .select("*")
    .eq("company_id", session.company_id)
    .eq("is_active", true)
    .order("display_order");
  return ((data as SavingsBrand[] | null) ?? []);
}

export async function upsertSavingsBrandAction(input: Partial<SavingsBrand> & { id?: string }) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo admin");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload = { ...input, company_id: session.company_id };
  const { error } = await admin
    .from("savings_water_brands")
    .upsert(payload, { onConflict: "id" });
  if (error) throw new Error(error.message);
  revalidatePath("/configuracion/calculadora-ahorro");
}

export async function refreshScraperPricesAction(): Promise<
  | { ok: true; stats: { ok: number; failed: number; total: number } }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { refreshAllScraperPrices } = await import("./scrapers");
    const stats = await refreshAllScraperPrices(admin, session.company_id);
    revalidatePath("/configuracion/calculadora-ahorro");
    return { ok: true, stats };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[refreshScraperPrices]", e);
    return { ok: false, error: msg };
  }
}

export async function deleteSavingsBrandAction(id: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo admin");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("savings_water_brands")
    .update({ is_active: false })
    .eq("id", id)
    .eq("company_id", session.company_id);
  revalidatePath("/configuracion/calculadora-ahorro");
}

// =============================================================================
// Productos para el wizard (con extras compatibles)
// =============================================================================

export interface WizardProduct {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  category_accepts_extras: boolean;
  product_type_hint: "osmosis" | "dispenser" | "other"; // sólo orientativo
  pricing: Array<{
    plan_type: "cash" | "rental" | "renting";
    duration_months: number | null;
    monthly_cents: number | null;
    total_cents: number | null;
    deposit_cents: number | null;
  }>;
}

export interface WizardExtra {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  extra_role: "tap" | "cooler";
  // Atributos descriptivos (vías para grifo, etc.)
  attributes: Record<string, string | number | null>;
  pricing: WizardProduct["pricing"];
  install_cents: number | null;
}

export async function listWizardProducts(filters: {
  client_type: "home" | "office";
  plan_type: "cash" | "rental" | "renting";
}): Promise<WizardProduct[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // Productos equipment activos con su categoría (incluye flag accepts_extras)
  const { data: rows } = await supabase
    .from("products")
    .select(
      "id, name, category_id, kind, product_categories(id, name, accepts_extras, extra_role)",
    )
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .eq("kind", "equipment");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products = ((rows as any[]) ?? []).filter(
    (p) => !p.product_categories || p.product_categories.extra_role == null,
  );

  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);
  const { data: plans } = await supabase
    .from("product_pricing_plans")
    .select(
      "product_id, plan_type, duration_months, monthly_price_cents, total_price_cents, deposit_cents, is_active",
    )
    .in("product_id", productIds)
    .eq("is_active", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plansList = ((plans as any[]) ?? []);

  return products
    .map((p) => {
      const cat = p.product_categories;
      // Heurística product_type_hint para usar en UI (icono):
      // si la categoría tiene accepts_extras=true → "osmosis"; si no, "dispenser".
      const hint = cat?.accepts_extras ? "osmosis" : "dispenser";
      return {
        id: p.id,
        name: p.name,
        category_id: cat?.id ?? null,
        category_name: cat?.name ?? null,
        category_accepts_extras: !!cat?.accepts_extras,
        product_type_hint: hint as "osmosis" | "dispenser" | "other",
        pricing: plansList
          .filter((pl) => pl.product_id === p.id && pl.plan_type === filters.plan_type)
          .map((pl) => ({
            plan_type: pl.plan_type,
            duration_months: pl.duration_months,
            monthly_cents: pl.monthly_price_cents,
            total_cents: pl.total_price_cents,
            deposit_cents: pl.deposit_cents,
          })),
      };
    })
    .filter((p) => p.pricing.length > 0);
}

export async function listWizardExtras(filters: {
  plan_type: "cash" | "rental" | "renting";
}): Promise<WizardExtra[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: rows } = await supabase
    .from("products")
    .select(
      "id, name, category_id, kind, product_categories!inner(id, name, extra_role)",
    )
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .in("kind", ["accessory"])
    .not("product_categories.extra_role", "is", null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products = ((rows as any[]) ?? []);
  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);
  const [plansRes, attrsRes] = await Promise.all([
    supabase
      .from("product_pricing_plans")
      .select(
        "product_id, plan_type, duration_months, monthly_price_cents, total_price_cents, install_price_cents, deposit_cents, is_active",
      )
      .in("product_id", productIds)
      .eq("is_active", true),
    supabase
      .from("product_attribute_values")
      .select("product_id, value, product_attributes(key, label)")
      .in("product_id", productIds),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plansList = ((plansRes.data as any[]) ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attrsList = ((attrsRes.data as any[]) ?? []);

  return products
    .map((p) => {
      const cat = p.product_categories;
      const productPlans = plansList.filter(
        (pl) => pl.product_id === p.id && pl.plan_type === filters.plan_type,
      );
      // Coger el primer plan para extraer install_cents
      const install = productPlans.find((pl) => pl.install_price_cents != null);
      const attrs: Record<string, string | number | null> = {};
      for (const a of attrsList.filter((x) => x.product_id === p.id)) {
        const k = a.product_attributes?.key;
        if (k) attrs[k] = a.value;
      }
      return {
        id: p.id,
        name: p.name,
        category_id: cat?.id ?? null,
        category_name: cat?.name ?? null,
        extra_role: (cat?.extra_role ?? "tap") as "tap" | "cooler",
        attributes: attrs,
        pricing: productPlans.map((pl) => ({
          plan_type: pl.plan_type,
          duration_months: pl.duration_months,
          monthly_cents: pl.monthly_price_cents,
          total_cents: pl.total_price_cents,
          deposit_cents: pl.deposit_cents,
        })),
        install_cents: install?.install_price_cents ?? null,
      };
    })
    .filter((e) => e.pricing.length > 0);
}

// =============================================================================
// Cálculo + Guardar propuesta
// =============================================================================

export async function calculateSavings(
  inputs: CalcInputs,
): Promise<CalcResult> {
  const config = await getSavingsConfig();
  return computeSavings(config, inputs);
}

export interface SaveSavingsProposalInput {
  customer_id?: string | null;
  lead_id?: string | null;
  inputs: CalcInputs;
  brand_id?: string | null;
  brand_name_snapshot?: string | null;
  service_garrafas_per_month?: number | null;
  product_id?: string | null;
  product_name_snapshot?: string | null;
  extras_snapshot?: Array<{
    product_id: string;
    name: string;
    role: "tap" | "cooler";
    monthly_cents: number;
    install_cents: number;
  }>;
  notes?: string | null;
}

export async function saveSavingsProposalAction(
  input: SaveSavingsProposalInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const result = await calculateSavings(input.inputs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Ref code AH-YYYY-NNNN
    const year = new Date().getFullYear();
    const yearPrefix = `AH-${year}-`;
    const { data: last } = await admin
      .from("savings_proposals")
      .select("reference_code")
      .eq("company_id", session.company_id)
      .like("reference_code", `${yearPrefix}%`)
      .order("reference_code", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    const lastRef = (last as { reference_code: string | null } | null)?.reference_code;
    if (lastRef) {
      const m = lastRef.match(/-(\d+)$/);
      if (m) nextNum = parseInt(m[1]!, 10) + 1;
    }
    const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

    const { data, error } = await admin
      .from("savings_proposals")
      .insert({
        company_id: session.company_id,
        reference_code: referenceCode,
        customer_id: input.customer_id ?? null,
        lead_id: input.lead_id ?? null,
        created_by: session.user_id,
        client_type: input.inputs.client_type,
        num_people: input.inputs.num_people,
        liters_per_person_day:
          input.inputs.liters_per_person_day_override ??
          (input.inputs.client_type === "office" ? 0.5 : 2.0),
        current_service: input.inputs.current_service,
        current_brand_id: input.brand_id ?? null,
        current_brand_name_snapshot: input.brand_name_snapshot ?? null,
        current_price_per_liter_cents: input.inputs.current_price_per_liter_cents ?? null,
        current_garrafas_per_month: input.service_garrafas_per_month ?? null,
        current_monthly_cost_cents: result.current_monthly_cost_cents,
        product_id: input.product_id ?? null,
        product_name_snapshot: input.product_name_snapshot ?? null,
        plan_type: input.inputs.plan_type,
        duration_months: input.inputs.duration_months ?? null,
        product_unit_price_cents: input.inputs.product_unit_price_cents,
        num_units: input.inputs.num_units,
        extras: input.extras_snapshot ?? [],
        total_monthly_cost_cents: result.total_monthly_cost_cents,
        deposit_cents: result.deposit_cents,
        payback_months: result.payback_months,
        total_saved_5y_cents: result.total_saved_5y_cents,
        bottles_saved_year: result.bottles_saved_year,
        co2_saved_year_kg: result.co2_saved_year_kg,
        plastic_saved_year_kg: result.plastic_saved_year_kg,
        notes: input.notes ?? null,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/calculadora-ahorro");
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[saveSavingsProposal]", e);
    return { ok: false, error: msg };
  }
}
