"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface PricingPlan {
  id: string;
  product_id: string;
  plan_type: "cash" | "renting" | "rental";
  duration_months: number | null;
  /** Legacy: mismo valor que monthly_price_individual_cents para retro-compat. */
  monthly_price_cents: number | null;
  /** Legacy: mismo valor que total_price_individual_cents para retro-compat. */
  total_price_cents: number;
  financing_coefficient: number | null;
  /** Legacy: financier_payment_cents (era el percibido por la empresa cuando el cliente era particular). */
  financier_payment_cents: number | null;
  // ---- Precios DUALES (Fase 1) ----------------------------------------
  /** Cuota mensual particular — IVA incluido. */
  monthly_price_individual_cents: number | null;
  /** Cuota mensual empresa/autónomo — BASE (se suma IVA encima). */
  monthly_price_business_cents: number | null;
  /** Total particular — IVA incluido. */
  total_price_individual_cents: number | null;
  /** Total empresa/autónomo — BASE. */
  total_price_business_cents: number | null;
  /** Capital percibido empresa cuando cliente es empresa/autónomo. */
  financier_payment_business_cents: number | null;
  permanence_months: number | null;
  min_authorized_cents: number;
  absolute_min_cents: number;
  is_active: boolean;
  display_order: number;
}

const pricingUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid(),
  plan_type: z.enum(["cash", "renting", "rental"]),
  duration_months: z.coerce.number().int().min(1).optional().nullable(),
  // Legacy: si vienen, se usan como fallback al rellenar individual_cents.
  monthly_price_cents: z.coerce.number().int().min(0).optional().nullable(),
  total_price_cents: z.coerce.number().int().min(0).optional().nullable(),
  financing_coefficient: z.coerce.number().min(0).optional().nullable(),
  financier_payment_cents: z.coerce.number().int().min(0).optional().nullable(),
  // ---- Duales ----
  monthly_price_individual_cents: z.coerce.number().int().min(0).optional().nullable(),
  monthly_price_business_cents: z.coerce.number().int().min(0).optional().nullable(),
  total_price_individual_cents: z.coerce.number().int().min(0).optional().nullable(),
  total_price_business_cents: z.coerce.number().int().min(0).optional().nullable(),
  financier_payment_business_cents: z.coerce.number().int().min(0).optional().nullable(),
  permanence_months: z.coerce.number().int().min(0).optional().nullable(),
  min_authorized_cents: z.coerce.number().int().min(0),
  absolute_min_cents: z.coerce.number().int().min(0),
});

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

/** Columnas legacy + duales. Si la BD aún no tiene las duales (cache obsoleto)
 *  caemos al subset legacy. */
const FULL_SELECT =
  "id, product_id, plan_type, duration_months, monthly_price_cents, total_price_cents, financing_coefficient, financier_payment_cents, monthly_price_individual_cents, monthly_price_business_cents, total_price_individual_cents, total_price_business_cents, financier_payment_business_cents, permanence_months, min_authorized_cents, absolute_min_cents, is_active, display_order";
const LEGACY_SELECT =
  "id, product_id, plan_type, duration_months, monthly_price_cents, total_price_cents, financing_coefficient, financier_payment_cents, permanence_months, min_authorized_cents, absolute_min_cents, is_active, display_order";

export async function listPricingPlans(productId: string): Promise<PricingPlan[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let res = await supabase
    .from("product_pricing_plans")
    .select(FULL_SELECT)
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("plan_type")
    .order("duration_months");
  if (
    res.error &&
    /(does not exist|schema cache|Could not find)/i.test(res.error.message ?? "")
  ) {
    console.warn(
      "[listPricingPlans] dual cols no visibles, fallback legacy:",
      res.error.message,
    );
    res = await supabase
      .from("product_pricing_plans")
      .select(LEGACY_SELECT)
      .eq("product_id", productId)
      .eq("is_active", true)
      .order("plan_type")
      .order("duration_months");
  }
  const rows = (res.data ?? []) as Array<Partial<PricingPlan>>;
  // Normalizamos: si falta el campo dual lo derivamos del legacy.
  return rows.map((r) => ({
    id: r.id!,
    product_id: r.product_id!,
    plan_type: r.plan_type!,
    duration_months: r.duration_months ?? null,
    monthly_price_cents: r.monthly_price_cents ?? null,
    total_price_cents: r.total_price_cents ?? 0,
    financing_coefficient: r.financing_coefficient ?? null,
    financier_payment_cents: r.financier_payment_cents ?? null,
    monthly_price_individual_cents:
      r.monthly_price_individual_cents ?? r.monthly_price_cents ?? null,
    monthly_price_business_cents: r.monthly_price_business_cents ?? null,
    total_price_individual_cents:
      r.total_price_individual_cents ?? r.total_price_cents ?? null,
    total_price_business_cents: r.total_price_business_cents ?? null,
    financier_payment_business_cents:
      r.financier_payment_business_cents ?? r.financier_payment_cents ?? null,
    permanence_months: r.permanence_months ?? null,
    min_authorized_cents: r.min_authorized_cents ?? 0,
    absolute_min_cents: r.absolute_min_cents ?? 0,
    is_active: r.is_active ?? true,
    display_order: r.display_order ?? 0,
  }));
}

export async function upsertPricingPlanAction(input: unknown) {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = parseOrFriendly(pricingUpsertSchema, input, "Precio producto");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // SEGURIDAD: admin salta RLS → verificar que el producto es de tu empresa
  // antes de crear/editar un plan de precio (si no, se cuelga de un product_id ajeno).
  const { data: ownProduct } = await admin
    .from("products")
    .select("id")
    .eq("id", parsed.product_id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!ownProduct) throw new Error("Producto no encontrado o no pertenece a tu empresa");

  // Validación: al menos un precio debe estar relleno.
  const indivTotal = parsed.total_price_individual_cents ?? parsed.total_price_cents;
  const bizTotal = parsed.total_price_business_cents;
  if ((indivTotal == null || indivTotal <= 0) && (bizTotal == null || bizTotal <= 0)) {
    throw new Error(
      "Indica al menos uno de los dos precios totales (particular o empresa).",
    );
  }

  // La columna legacy `total_price_cents` es NOT NULL — la rellenamos con
  // el precio individual (o el de empresa si solo hay ese) para no romper.
  const legacyTotal =
    parsed.total_price_individual_cents ??
    parsed.total_price_cents ??
    parsed.total_price_business_cents ??
    0;
  const legacyMonthly =
    parsed.monthly_price_individual_cents ??
    parsed.monthly_price_cents ??
    parsed.monthly_price_business_cents ??
    null;

  // Mínimos: si min_authorized_cents/absolute_min_cents vienen como 0 (no
  // los usamos en el nuevo flujo), los anclamos al legacyTotal para que
  // los checks de la tabla pasen (absolute <= min <= total).
  const minAuthorized =
    parsed.min_authorized_cents && parsed.min_authorized_cents > 0
      ? Math.min(parsed.min_authorized_cents, legacyTotal)
      : legacyTotal;
  const absoluteMin =
    parsed.absolute_min_cents && parsed.absolute_min_cents > 0
      ? Math.min(parsed.absolute_min_cents, minAuthorized)
      : minAuthorized;

  const fullPayload: Record<string, unknown> = {
    company_id: session.company_id,
    product_id: parsed.product_id,
    plan_type: parsed.plan_type,
    duration_months: parsed.duration_months ?? null,
    // Legacy (NOT NULL para total)
    monthly_price_cents: legacyMonthly,
    total_price_cents: legacyTotal,
    financing_coefficient: parsed.financing_coefficient ?? null,
    financier_payment_cents: parsed.financier_payment_cents ?? null,
    // Duales
    monthly_price_individual_cents: parsed.monthly_price_individual_cents ?? null,
    monthly_price_business_cents: parsed.monthly_price_business_cents ?? null,
    total_price_individual_cents: parsed.total_price_individual_cents ?? null,
    total_price_business_cents: parsed.total_price_business_cents ?? null,
    financier_payment_business_cents: parsed.financier_payment_business_cents ?? null,
    permanence_months: parsed.permanence_months ?? null,
    min_authorized_cents: minAuthorized,
    absolute_min_cents: absoluteMin,
    is_active: true,
  };

  // UPSERT defensivo: si una columna dual no existe en BD (schema cache
  // obsoleto), la quitamos y reintentamos. Así nunca se cae el guardado.
  const DUAL_KEYS = [
    "monthly_price_individual_cents",
    "monthly_price_business_cents",
    "total_price_individual_cents",
    "total_price_business_cents",
    "financier_payment_business_cents",
  ];
  const payload = { ...fullPayload };
  for (let i = 0; i < 10; i++) {
    const r = parsed.id
      ? await admin
          .from("product_pricing_plans")
          .update(payload)
          .eq("id", parsed.id)
          .eq("company_id", session.company_id)
      : await admin.from("product_pricing_plans").insert(payload);
    if (!r.error) break;
    const msg = r.error.message ?? "";
    const m =
      msg.match(/column "?([a-z_]+)"? .* does not exist/i) ??
      msg.match(/'([a-z_]+)' column .* schema cache/i) ??
      msg.match(/Could not find the '([a-z_]+)' column/i);
    if (m && m[1] && DUAL_KEYS.includes(m[1]) && m[1] in payload) {
      console.warn("[upsertPricingPlan] dropping unknown column", m[1]);
      delete payload[m[1]];
      continue;
    }
    throw new Error(msg);
  }
  revalidatePath(`/productos/${parsed.product_id}`);
}

export async function deletePricingPlanAction(id: string, productId: string) {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin salta RLS → filtrar por company_id.
  await admin
    .from("product_pricing_plans")
    .update({ is_active: false })
    .eq("id", id)
    .eq("company_id", session.company_id);
  revalidatePath(`/productos/${productId}`);
}

// =================== Safe wrappers ===================

export async function upsertPricingPlanSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await upsertPricingPlanAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deletePricingPlanSafeAction(
  id: string,
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deletePricingPlanAction(id, productId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
