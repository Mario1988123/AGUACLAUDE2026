"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface PurchaseSuggestionRow {
  id: string;
  product_id: string;
  product_name: string;
  suggested_qty: number;
  approved_qty: number | null;
  reason: string | null;
  status: "pending" | "approved" | "dismissed" | "ordered";
  created_at: string;
}

async function ensureAdminOrDirector() {
  const session = await requireSession();
  const ok =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!ok) throw new Error("Solo admin o director técnico");
  return session;
}

export async function listPendingPurchaseSuggestions(): Promise<
  PurchaseSuggestionRow[]
> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("purchase_suggestions")
    .select(
      "id, product_id, suggested_qty, approved_qty, reason, status, created_at",
    )
    .eq("company_id", session.company_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  type R = Omit<PurchaseSuggestionRow, "product_name">;
  const rows = (data ?? []) as R[];
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.product_id)));
  const { data: prods } = await admin
    .from("products")
    .select("id, name")
    .in("id", ids);
  const nameMap = new Map<string, string>();
  for (const p of (prods ?? []) as Array<{ id: string; name: string }>) {
    nameMap.set(p.id, p.name);
  }
  return rows.map((r) => ({
    ...r,
    product_name: nameMap.get(r.product_id) ?? "—",
  }));
}

/** Recalcula sugerencias en base a stock_min/max y stock actual.
 *  Acumula: si ya hay una pendiente para el mismo producto, suma cantidades. */
export async function recomputePurchaseSuggestionsAction(): Promise<{
  ok: boolean;
  created: number;
  error?: string;
}> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, created: 0, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const out = await recomputeInternal(admin, session.company_id);
    revalidatePath("/almacenes/sugerencias");
    revalidatePath("/configuracion/almacenes");
    return { ok: true, created: out.created };
  } catch (e) {
    return {
      ok: false,
      created: 0,
      error: e instanceof Error ? e.message : "Error",
    };
  }
}

/** Helper para el cron (sin requireSession). */
export async function recomputeSuggestionsForCompany(
  companyId: string,
): Promise<{ created: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  return recomputeInternal(admin, companyId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recomputeInternal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
): Promise<{ created: number }> {
  const { data: prods } = await admin
    .from("products")
    .select("id, name, stock_min, stock_max, lead_time_days")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .eq("stock_managed", true);
  type P = {
    id: string;
    name: string;
    stock_min: number;
    stock_max: number | null;
    lead_time_days: number | null;
  };
  const products = (prods ?? []) as P[];
  if (products.length === 0) return { created: 0 };
  const { data: stocks } = await admin
    .from("warehouse_stock")
    .select("product_id, quantity")
    .in("product_id", products.map((p) => p.id));
  const totalByProduct = new Map<string, number>();
  for (const s of ((stocks ?? []) as Array<{
    product_id: string;
    quantity: number;
  }>)) {
    totalByProduct.set(
      s.product_id,
      (totalByProduct.get(s.product_id) ?? 0) + Number(s.quantity),
    );
  }
  let created = 0;
  for (const p of products) {
    const total = totalByProduct.get(p.id) ?? 0;
    if (total >= p.stock_min) continue;
    const target = p.stock_max ?? p.stock_min * 2;
    const needed = Math.max(1, Math.ceil(target - total));
    const { data: existing } = await admin
      .from("purchase_suggestions")
      .select("id, suggested_qty")
      .eq("company_id", companyId)
      .eq("product_id", p.id)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) {
      const e = existing as { id: string; suggested_qty: number };
      const newQty = Math.max(Number(e.suggested_qty), needed);
      if (newQty !== Number(e.suggested_qty)) {
        await admin
          .from("purchase_suggestions")
          .update({ suggested_qty: newQty })
          .eq("id", e.id);
      }
    } else {
      const r = await admin.from("purchase_suggestions").insert({
        company_id: companyId,
        product_id: p.id,
        suggested_qty: needed,
        reason: `Stock ${total} < mínimo ${p.stock_min}. Sugerido hasta ${target}.`,
      });
      if (!r.error) created++;
    }
  }
  return { created };
}

export async function approvePurchaseSuggestionAction(
  id: string,
  approvedQty: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (approvedQty <= 0)
      return { ok: false, error: "Cantidad debe ser > 0" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // SEGURIDAD: admin salta RLS → filtrar por company_id.
    const r = await admin
      .from("purchase_suggestions")
      .update({
        approved_qty: approvedQty,
        status: "approved",
        reviewed_by: session.user_id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", session.company_id)
      .select("id");
    if (r.error) return { ok: false, error: r.error.message };
    if (!r.data?.length)
      return { ok: false, error: "Sugerencia no encontrada o no pertenece a tu empresa" };
    revalidatePath("/almacenes/sugerencias");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}

export async function dismissPurchaseSuggestionAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // SEGURIDAD: admin salta RLS → filtrar por company_id.
    const r = await admin
      .from("purchase_suggestions")
      .update({
        status: "dismissed",
        reviewed_by: session.user_id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", session.company_id)
      .select("id");
    if (r.error) return { ok: false, error: r.error.message };
    if (!r.data?.length)
      return { ok: false, error: "Sugerencia no encontrada o no pertenece a tu empresa" };
    revalidatePath("/almacenes/sugerencias");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}
