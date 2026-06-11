"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const bulkSchema = z.object({
  product_ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum([
    "activate",
    "deactivate",
    "show_in_calculator_on",
    "show_in_calculator_off",
    "change_category",
    "adjust_price_pct",
  ]),
  category_id: z.string().uuid().nullish(),
  adjust_pct: z.number().nullish(), // -50 ... +50 típicamente
  reason: z.string().trim().max(200).nullish(),
});

/**
 * Operaciones bulk sobre productos. Solo admin / director comercial.
 * Límite 200 ids para no acabar con un UPDATE sobre toda la BD.
 *
 * Acciones soportadas:
 *  - activate / deactivate: cambia is_active.
 *  - show_in_calculator_on / off: cambia show_in_calculator.
 *  - change_category: requiere category_id (nullable para "Sin categoría").
 *  - adjust_price_pct: ajusta cash_price_cents en ±X% y registra en
 *    product_price_history.
 */
export async function bulkProductsAction(
  input: unknown,
): Promise<{ ok: true; affected: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) return { ok: false, error: "Solo admin o director comercial" };

    const parsed = parseOrFriendly(bulkSchema, input, "Bulk productos");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    if (parsed.action === "activate" || parsed.action === "deactivate") {
      const r = await admin
        .from("products")
        .update({ is_active: parsed.action === "activate" })
        .eq("company_id", session.company_id)
        .in("id", parsed.product_ids);
      if (r.error) return { ok: false, error: r.error.message };
    } else if (
      parsed.action === "show_in_calculator_on" ||
      parsed.action === "show_in_calculator_off"
    ) {
      const r = await admin
        .from("products")
        .update({
          show_in_calculator: parsed.action === "show_in_calculator_on",
        })
        .eq("company_id", session.company_id)
        .in("id", parsed.product_ids);
      if (r.error) return { ok: false, error: r.error.message };
    } else if (parsed.action === "change_category") {
      const r = await admin
        .from("products")
        .update({ category_id: parsed.category_id ?? null })
        .eq("company_id", session.company_id)
        .in("id", parsed.product_ids);
      if (r.error) return { ok: false, error: r.error.message };
    } else if (parsed.action === "adjust_price_pct") {
      const pct = parsed.adjust_pct ?? 0;
      if (pct === 0 || pct < -90 || pct > 1000) {
        return { ok: false, error: "Porcentaje fuera de rango (-90 a +1000)" };
      }
      // El precio NO vive en products.cash_price_cents (columna inexistente),
      // sino en product_pricing_plans (plan_type='cash'). Ajustamos ahí los
      // totales (individual/empresa/legacy) en ±pct y registramos histórico.
      const factor = 1 + pct / 100;
      const { data: plans } = await admin
        .from("product_pricing_plans")
        .select(
          "id, product_id, total_price_cents, total_price_individual_cents, total_price_business_cents",
        )
        .eq("company_id", session.company_id)
        .eq("plan_type", "cash")
        .in("product_id", parsed.product_ids);
      type Plan = {
        id: string;
        product_id: string;
        total_price_cents: number | null;
        total_price_individual_cents: number | null;
        total_price_business_cents: number | null;
      };
      const list = (plans ?? []) as Plan[];
      const scale = (v: number | null) =>
        v == null ? null : Math.round(v * factor);
      let affected = 0;
      for (const pl of list) {
        const prevTotal = pl.total_price_cents;
        const newTotal = scale(pl.total_price_cents);
        const upd = await admin
          .from("product_pricing_plans")
          .update({
            ...(newTotal != null ? { total_price_cents: newTotal } : {}),
            total_price_individual_cents: scale(pl.total_price_individual_cents),
            total_price_business_cents: scale(pl.total_price_business_cents),
          })
          .eq("id", pl.id)
          .eq("company_id", session.company_id);
        if (upd.error) continue;
        try {
          await admin.from("product_price_history").insert({
            company_id: session.company_id,
            product_id: pl.product_id,
            changed_by: session.user_id,
            change_kind: "cash_price",
            plan_type: "cash",
            previous_cents: prevTotal,
            new_cents: newTotal ?? prevTotal ?? 0,
            reason: parsed.reason ?? `Bulk ajuste ${pct > 0 ? "+" : ""}${pct}%`,
          });
        } catch {
          /* histórico falla soft si tabla no migrada */
        }
        affected += 1;
      }
      revalidatePath("/productos");
      return { ok: true, affected };
    }

    revalidatePath("/productos");
    return { ok: true, affected: parsed.product_ids.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

export interface PriceHistoryRow {
  id: string;
  changed_at: string;
  changed_by_name: string | null;
  change_kind: string;
  plan_type: string | null;
  duration_months: number | null;
  previous_cents: number | null;
  new_cents: number;
  reason: string | null;
}

export async function listPriceHistory(productId: string): Promise<PriceHistoryRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("product_price_history")
      .select(
        "id, changed_at, changed_by, change_kind, plan_type, duration_months, previous_cents, new_cents, reason",
      )
      .eq("product_id", productId)
      .eq("company_id", session.company_id)
      .order("changed_at", { ascending: false })
      .limit(200);
    type Row = Omit<PriceHistoryRow, "changed_by_name"> & {
      changed_by: string | null;
    };
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return [];
    const userIds = Array.from(
      new Set(rows.map((r) => r.changed_by).filter((v): v is string => !!v)),
    );
    let nameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profs } = await admin
        .from("user_profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      nameMap = new Map(
        ((profs ?? []) as Array<{ user_id: string; full_name: string | null }>).map(
          (p) => [p.user_id, p.full_name ?? "?"],
        ),
      );
    }
    return rows.map((r) => ({
      id: r.id,
      changed_at: r.changed_at,
      changed_by_name: r.changed_by ? nameMap.get(r.changed_by) ?? null : null,
      change_kind: r.change_kind,
      plan_type: r.plan_type,
      duration_months: r.duration_months,
      previous_cents: r.previous_cents,
      new_cents: r.new_cents,
      reason: r.reason,
    }));
  } catch {
    return [];
  }
}
