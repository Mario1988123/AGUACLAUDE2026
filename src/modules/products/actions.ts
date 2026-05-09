"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { productCreateSchema } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import type { CategoryItem, ProductDetail, ProductListItem, ProductKind } from "./types";

export async function listProducts(filters?: {
  kind?: string;
  category_id?: string;
  q?: string;
  active_only?: boolean;
}): Promise<ProductListItem[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // Defensivo: si la migración show_in_calculator no está aplicada, hacemos
  // un select sin esa columna y ponemos false por defecto.
  async function runQuery(includeShowInCalc: boolean) {
    const cols = includeShowInCalc
      ? "id, name, kind, category_id, internal_reference, is_active, main_image_url, show_in_calculator"
      : "id, name, kind, category_id, internal_reference, is_active, main_image_url";
    let q = supabase.from("products").select(cols).is("deleted_at", null).order("name");
    if (filters?.kind) q = q.eq("kind", filters.kind);
    if (filters?.category_id) q = q.eq("category_id", filters.category_id);
    if (filters?.active_only) q = q.eq("is_active", true);
    if (filters?.q) {
      const txt = filters.q.replace(/[%_]/g, "");
      q = q.or(`name.ilike.%${txt}%,internal_reference.ilike.%${txt}%`);
    }
    return q;
  }
  let { data: products, error } = await runQuery(true);
  if (error && /show_in_calculator/i.test(error.message ?? "")) {
    const fb = await runQuery(false);
    products = fb.data;
    error = fb.error;
  }
  if (error) throw error;
  const rows = (products ?? []) as Array<{
    id: string;
    name: string;
    kind: ProductKind;
    category_id: string | null;
    internal_reference: string | null;
    is_active: boolean;
    main_image_url: string | null;
    show_in_calculator?: boolean;
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

  const cats = new Map(
    ((catRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );
  const cashPrices = new Map(
    ((plansRes.data ?? []) as Array<{ product_id: string; total_price_cents: number }>).map(
      (p) => [p.product_id, p.total_price_cents],
    ),
  );

  return rows.map((p) => ({
    ...p,
    show_in_calculator: p.show_in_calculator ?? false,
    category_name: p.category_id ? cats.get(p.category_id) ?? null : null,
    cash_price_cents: cashPrices.get(p.id) ?? null,
  }));
}

export interface ProductForProposal {
  id: string;
  name: string;
  main_image_url: string | null;
  plans: Array<{
    plan_type: "cash" | "rental" | "renting";
    duration_months: number | null;
    permanence_months: number | null;
    monthly_price_cents: number | null;
    total_price_cents: number;
    min_authorized_cents: number | null;
    absolute_min_cents: number | null;
  }>;
}

/**
 * Listado de productos activos con TODOS sus planes activos. Lo usa el form
 * de creación de propuesta para saber qué planes ofrecer y precargar cuotas.
 */
export async function listProductsForProposal(): Promise<ProductForProposal[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: products } = await supabase
    .from("products")
    .select("id, name, main_image_url")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name");
  type P = { id: string; name: string; main_image_url: string | null };
  const list = (products ?? []) as P[];
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id);
  const { data: plans } = await supabase
    .from("product_pricing_plans")
    .select(
      "product_id, plan_type, duration_months, permanence_months, monthly_price_cents, total_price_cents, min_authorized_cents, absolute_min_cents",
    )
    .in("product_id", ids)
    .eq("is_active", true);
  type Pl = ProductForProposal["plans"][number] & { product_id: string };
  const plansByProduct = new Map<string, Pl[]>();
  for (const pl of (plans ?? []) as Pl[]) {
    const arr = plansByProduct.get(pl.product_id) ?? [];
    arr.push(pl);
    plansByProduct.set(pl.product_id, arr);
  }
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    main_image_url: p.main_image_url,
    plans: plansByProduct.get(p.id) ?? [],
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: gc } = await admin
    .from("product_categories_global")
    .select("id, name_es, default_kind, sort_order")
    .eq("id", globalCategoryId)
    .single();
  if (!gc) throw new Error("Categoría global no encontrada");
  const g = gc as { id: string; name_es: string; default_kind: ProductKind; sort_order: number };

  const { error } = await admin.from("product_categories").insert({
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin.from("product_categories").insert({
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
  const parsed = parseOrFriendly(
    productCreateSchema,
    {
      ...raw,
      stock_managed: raw.stock_managed === "on" || raw.stock_managed === "true",
    },
    "Producto",
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
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
      // Coste real = CMP de compras. NO se introduce a mano (decisión 2026-05-09).
      cost_cents: null,
      supplier_price_cents: null,
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
    await admin.from("product_pricing_plans").insert({
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

  // Atributos precargados desde la categoría: vienen como JSON string.
  // Estructura: [{attribute_id, value_text?, value_number?, value_boolean?}]
  const attrValuesRaw = formData.get("attribute_values");
  if (typeof attrValuesRaw === "string" && attrValuesRaw.trim().length > 0) {
    try {
      const items = JSON.parse(attrValuesRaw) as Array<{
        attribute_id: string;
        value_text?: string | null;
        value_number?: number | null;
        value_boolean?: boolean | null;
      }>;
      const rows = items
        .filter(
          (x) =>
            (x.value_text != null && x.value_text !== "") ||
            x.value_number != null ||
            x.value_boolean != null,
        )
        .map((x, i) => ({
          product_id: productId,
          attribute_id: x.attribute_id,
          company_id: session.company_id,
          value_text: x.value_text ?? null,
          value_number: x.value_number ?? null,
          value_boolean: x.value_boolean ?? null,
          is_visible: true,
          is_featured: false,
          display_order: i,
        }));
      if (rows.length > 0) {
        const { error: avErr } = await admin
          .from("product_attribute_values")
          .insert(rows);
        if (avErr) console.error("[create product] attribute values insert:", avErr.message);
      }
    } catch (e) {
      console.error("[create product] bad attribute_values JSON:", e);
    }
  }

  revalidatePath("/productos");
  redirect(`/productos/${productId}` as never);
}

export type ProductActionResult = { ok: true } | { ok: false; error: string };

/**
 * Actualiza datos generales y costes admin de un producto. Solo admin.
 */
export async function updateProductAction(
  productId: string,
  input: {
    name?: string;
    category_id?: string | null;
    internal_reference?: string | null;
    supplier_reference?: string | null;
    short_description?: string | null;
    long_description?: string | null;
    cost_cents?: number | null;
    supplier_price_cents?: number | null;
    dim_width_mm?: number | null;
    dim_height_mm?: number | null;
    dim_depth_mm?: number | null;
    weight_grams?: number | null;
    stock_managed?: boolean;
    stock_min?: number | null;
    stock_max?: number | null;
    lead_time_days?: number | null;
    default_supplier_name?: string | null;
    show_in_calculator?: boolean;
  },
): Promise<ProductActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin" };
    }
    // El coste real se gestiona por CMP desde compras: ignoramos cualquier
    // intento de actualizarlo a mano (decisión usuario 2026-05-09).
    delete (input as Record<string, unknown>).cost_cents;
    delete (input as Record<string, unknown>).supplier_price_cents;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Sanitizar: solo enviar las claves definidas
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) payload[k] = v;
    }

    const { error } = await admin
      .from("products")
      .update(payload)
      .eq("id", productId)
      .eq("company_id", session.company_id);
    if (error) {
      // Defensa: columnas nuevas pueden no existir si la migration no
      // se aplicó. Reintentar quitando las que falten.
      const newCols = [
        "show_in_calculator",
        "stock_max",
        "lead_time_days",
        "default_supplier_name",
      ];
      const re = new RegExp(`(${newCols.join("|")})`, "i");
      if (re.test(error.message ?? "") || (error as { code?: string }).code === "42703") {
        for (const col of newCols) delete payload[col];
        const r2 = await admin
          .from("products")
          .update(payload)
          .eq("id", productId)
          .eq("company_id", session.company_id);
        if (r2.error) return { ok: false, error: r2.error.message };
      } else {
        return { ok: false, error: error.message };
      }
    }
    revalidatePath(`/productos/${productId}`);
    revalidatePath("/productos");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[updateProduct]", e);
    return { ok: false, error: msg };
  }
}

/**
 * Toggle rápido del flag show_in_calculator desde el listado.
 */
export async function toggleShowInCalculatorAction(
  productId: string,
  value: boolean,
): Promise<ProductActionResult> {
  return updateProductAction(productId, { show_in_calculator: value });
}
