"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { productCreateSchema } from "./schemas";
import type { CategoryItem, ProductDetail, ProductListItem, ProductKind } from "./types";

export async function listProducts(): Promise<ProductListItem[]> {
  await requireSession();
  const supabase = await createClient();
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, kind, category_id, internal_reference, is_active, main_image_url")
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  const rows = (products ?? []) as Array<{
    id: string;
    name: string;
    kind: ProductKind;
    category_id: string | null;
    internal_reference: string | null;
    is_active: boolean;
    main_image_url: string | null;
  }>;
  if (rows.length === 0) return [];

  const productIds = rows.map((p) => p.id);
  const categoryIds = rows.map((p) => p.category_id).filter(Boolean) as string[];

  const [catRes, plansRes] = await Promise.all([
    categoryIds.length > 0
      ? supabase.from("product_categories").select("id, name").in("id", categoryIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    supabase
      .from("product_pricing_plans")
      .select("product_id, total_price_cents")
      .eq("plan_type", "cash")
      .in("product_id", productIds),
  ]);

  const cats = new Map((catRes.data ?? []).map((c) => [(c as { id: string }).id, (c as { name: string }).name]));
  const cashPrices = new Map(
    ((plansRes.data ?? []) as Array<{ product_id: string; total_price_cents: number }>).map(
      (p) => [p.product_id, p.total_price_cents],
    ),
  );

  return rows.map((p) => ({
    ...p,
    category_name: p.category_id ? cats.get(p.category_id) ?? null : null,
    cash_price_cents: cashPrices.get(p.id) ?? null,
  }));
}

export async function getProduct(id: string): Promise<ProductDetail> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as ProductDetail;
}

export async function listCategories(): Promise<CategoryItem[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, name, default_kind, sort_order, is_active, cloned_from_global_id")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as CategoryItem[];
}

export async function listGlobalCategories() {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories_global")
    .select("id, key, name_es, default_kind, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    key: string;
    name_es: string;
    default_kind: ProductKind;
    sort_order: number;
  }>;
}

export async function cloneGlobalCategoryAction(globalCategoryId: string) {
  const session = await requireSession();
  if (!session.company_id || !session.roles.includes("company_admin")) {
    throw new Error("Solo admin");
  }
  const supabase = await createClient();
  const { data: gc } = await supabase
    .from("product_categories_global")
    .select("id, name_es, default_kind, sort_order")
    .eq("id", globalCategoryId)
    .single();
  if (!gc) throw new Error("Categoría global no encontrada");
  const g = gc as { id: string; name_es: string; default_kind: ProductKind; sort_order: number };

  const { error } = await supabase.from("product_categories").insert({
    company_id: session.company_id,
    cloned_from_global_id: g.id,
    name: g.name_es,
    default_kind: g.default_kind,
    sort_order: g.sort_order,
    is_active: true,
    created_by: session.user_id,
  } as never);
  if (error) throw error;
  revalidatePath("/configuracion/productos");
}

export async function createCategoryAction(formData: FormData) {
  const session = await requireSession();
  if (!session.company_id || !session.roles.includes("company_admin")) throw new Error("Solo admin");
  const name = String(formData.get("name") ?? "").trim();
  const default_kind = String(formData.get("default_kind") ?? "equipment");
  if (!name) throw new Error("Nombre obligatorio");
  const supabase = await createClient();
  const { error } = await supabase.from("product_categories").insert({
    company_id: session.company_id,
    name,
    default_kind,
    is_active: true,
    created_by: session.user_id,
  } as never);
  if (error) throw error;
  revalidatePath("/configuracion/productos");
}

export async function createProductAction(formData: FormData) {
  const session = await requireSession();
  if (!session.company_id || !session.roles.includes("company_admin"))
    throw new Error("Solo admin puede crear productos");
  const raw = Object.fromEntries(formData.entries());
  // stock_managed viene como string "on" o ausente
  const parsed = productCreateSchema.parse({
    ...raw,
    stock_managed: raw.stock_managed === "on" || raw.stock_managed === "true",
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      company_id: session.company_id,
      name: parsed.name,
      kind: parsed.kind,
      category_id: parsed.category_id || null,
      internal_reference: parsed.internal_reference || null,
      supplier_reference: parsed.supplier_reference || null,
      short_description: parsed.short_description || null,
      long_description: parsed.long_description || null,
      cost_cents: parsed.cost_cents,
      supplier_price_cents: parsed.supplier_price_cents,
      dim_width_mm: parsed.dim_width_mm,
      dim_height_mm: parsed.dim_height_mm,
      dim_depth_mm: parsed.dim_depth_mm,
      weight_grams: parsed.weight_grams,
      stock_managed: parsed.stock_managed,
      stock_min: parsed.stock_min,
      created_by: session.user_id,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const productId = (data as { id: string }).id;

  // Si dieron precio cash, crear plan
  if (parsed.cash_total_cents != null && parsed.cash_total_cents > 0) {
    const minAuth = parsed.cash_min_authorized_cents ?? parsed.cash_total_cents;
    const minAbs = parsed.cash_absolute_min_cents ?? minAuth;
    await supabase.from("product_pricing_plans").insert({
      company_id: session.company_id,
      product_id: productId,
      plan_type: "cash",
      duration_months: null,
      total_price_cents: parsed.cash_total_cents,
      min_authorized_cents: minAuth,
      absolute_min_cents: minAbs,
      is_active: true,
    } as never);
  }

  revalidatePath("/productos");
  redirect(`/productos/${productId}` as never);
}
