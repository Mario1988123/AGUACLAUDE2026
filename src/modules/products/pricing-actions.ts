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
  monthly_price_cents: number | null;
  total_price_cents: number;
  financing_coefficient: number | null;
  financier_payment_cents: number | null;
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
  monthly_price_cents: z.coerce.number().int().min(0).optional().nullable(),
  total_price_cents: z.coerce.number().int().min(0),
  financing_coefficient: z.coerce.number().min(0).optional().nullable(),
  financier_payment_cents: z.coerce.number().int().min(0).optional().nullable(),
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

export async function listPricingPlans(productId: string): Promise<PricingPlan[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_pricing_plans")
    .select(
      "id, product_id, plan_type, duration_months, monthly_price_cents, total_price_cents, financing_coefficient, financier_payment_cents, permanence_months, min_authorized_cents, absolute_min_cents, is_active, display_order",
    )
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("plan_type")
    .order("duration_months");
  return (data ?? []) as PricingPlan[];
}

export async function upsertPricingPlanAction(input: unknown) {
  const session = await ensureAdmin();
  const parsed = parseOrFriendly(pricingUpsertSchema, input, "Precio producto");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload = {
    company_id: session.company_id,
    product_id: parsed.product_id,
    plan_type: parsed.plan_type,
    duration_months: parsed.duration_months ?? null,
    monthly_price_cents: parsed.monthly_price_cents ?? null,
    total_price_cents: parsed.total_price_cents,
    financing_coefficient: parsed.financing_coefficient ?? null,
    financier_payment_cents: parsed.financier_payment_cents ?? null,
    permanence_months: parsed.permanence_months ?? null,
    min_authorized_cents: parsed.min_authorized_cents,
    absolute_min_cents: parsed.absolute_min_cents,
    is_active: true,
  };
  if (parsed.id) {
    const { error } = await admin.from("product_pricing_plans").update(payload).eq("id", parsed.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("product_pricing_plans").insert(payload);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/productos/${parsed.product_id}`);
}

export async function deletePricingPlanAction(id: string, productId: string) {
  await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("product_pricing_plans").update({ is_active: false }).eq("id", id);
  revalidatePath(`/productos/${productId}`);
}
