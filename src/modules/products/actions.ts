"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { productCreateSchema, PRODUCT_ROLES } from "./schemas";
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
  // Defensivo: si la migración show_in_calculator (o tags) no está aplicada,
  // hacemos un select sin esa columna y ponemos valor por defecto.
  async function runQuery(includeShowInCalc: boolean, includeTags: boolean) {
    const base =
      "id, name, kind, category_id, internal_reference, is_active, main_image_url";
    const cols =
      base +
      (includeShowInCalc ? ", show_in_calculator" : "") +
      (includeTags ? ", tags" : "");
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
  let { data: products, error } = await runQuery(true, true);
  if (error && /\btags\b/i.test(error.message ?? "")) {
    const fb = await runQuery(true, false);
    products = fb.data;
    error = fb.error;
  }
  if (error && /show_in_calculator/i.test(error.message ?? "")) {
    const fb = await runQuery(false, false);
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
    tags?: string[] | null;
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
    tags: Array.isArray(p.tags) ? p.tags : [],
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
    /** Legacy: igual que monthly_price_individual_cents si existe. */
    monthly_price_cents: number | null;
    total_price_cents: number;
    /** Precio particular — IVA incluido. */
    monthly_price_individual_cents: number | null;
    total_price_individual_cents: number | null;
    /** Precio empresa/autónomo — BASE imponible. */
    monthly_price_business_cents: number | null;
    total_price_business_cents: number | null;
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
  // SELECT defensivo: si las columnas duales no están en el cache,
  // caemos al subset legacy y derivamos los individuales del precio antiguo.
  const FULL_COLS =
    "product_id, plan_type, duration_months, permanence_months, monthly_price_cents, total_price_cents, monthly_price_individual_cents, monthly_price_business_cents, total_price_individual_cents, total_price_business_cents, min_authorized_cents, absolute_min_cents";
  const LEGACY_COLS =
    "product_id, plan_type, duration_months, permanence_months, monthly_price_cents, total_price_cents, min_authorized_cents, absolute_min_cents";
  let plansRes = await supabase
    .from("product_pricing_plans")
    .select(FULL_COLS)
    .in("product_id", ids)
    .eq("is_active", true);
  if (
    plansRes.error &&
    /(does not exist|schema cache|Could not find)/i.test(plansRes.error.message ?? "")
  ) {
    plansRes = await supabase
      .from("product_pricing_plans")
      .select(LEGACY_COLS)
      .in("product_id", ids)
      .eq("is_active", true);
  }
  type PlRaw = {
    product_id: string;
    plan_type: "cash" | "rental" | "renting";
    duration_months: number | null;
    permanence_months: number | null;
    monthly_price_cents: number | null;
    total_price_cents: number;
    monthly_price_individual_cents?: number | null;
    monthly_price_business_cents?: number | null;
    total_price_individual_cents?: number | null;
    total_price_business_cents?: number | null;
    min_authorized_cents: number | null;
    absolute_min_cents: number | null;
  };
  type Pl = ProductForProposal["plans"][number] & { product_id: string };
  const plansByProduct = new Map<string, Pl[]>();
  for (const raw of (plansRes.data ?? []) as PlRaw[]) {
    const pl: Pl = {
      product_id: raw.product_id,
      plan_type: raw.plan_type,
      duration_months: raw.duration_months,
      permanence_months: raw.permanence_months,
      monthly_price_cents: raw.monthly_price_cents,
      total_price_cents: raw.total_price_cents,
      monthly_price_individual_cents:
        raw.monthly_price_individual_cents ?? raw.monthly_price_cents ?? null,
      monthly_price_business_cents: raw.monthly_price_business_cents ?? null,
      total_price_individual_cents:
        raw.total_price_individual_cents ?? raw.total_price_cents ?? null,
      total_price_business_cents: raw.total_price_business_cents ?? null,
      min_authorized_cents: raw.min_authorized_cents,
      absolute_min_cents: raw.absolute_min_cents,
    };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const FULL =
    "id, name, default_kind, sort_order, is_active, cloned_from_global_id, parent_id, description, icon";
  const LEGACY = "id, name, default_kind, sort_order, is_active, cloned_from_global_id";
  let { data, error } = await supabase
    .from("product_categories")
    .select(FULL)
    .order("sort_order");
  // Defensivo: parent_id/description/icon ya existen en la migración base, pero
  // si por cualquier motivo el cache de esquema no las trae, caemos al subset.
  if (error && /(parent_id|description|icon)/i.test(error.message ?? "")) {
    const fb = await supabase.from("product_categories").select(LEGACY).order("sort_order");
    data = fb.data;
    error = fb.error;
  }
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
  if (error) {
    // Duplicado (unique company_id, name): mensaje legible en vez del error
    // técnico de Postgres (el wrapper Safe lo propaga a la UI).
    if (error.code === "23505" || /duplicate key|unique/i.test(error.message ?? "")) {
      throw new Error(
        `Ya tienes una categoría llamada "${g.name_es}". Renómbrala o edita la que ya hay.`,
      );
    }
    throw new Error(error.message);
  }
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

  // Pre-chequeo de duplicados SIN distinguir mayúsculas/tildes: tu copia
  // local no admite dos categorías con el mismo nombre (unique company_id,
  // name) y, al precargar del catálogo global, ya te quedan con esos
  // nombres. Avisamos claro en vez de soltar el error técnico de Postgres.
  const norm = (s: string) =>
    s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const { data: existingCats } = await admin
    .from("product_categories")
    .select("name")
    .eq("company_id", session.company_id);
  const dup = ((existingCats ?? []) as Array<{ name: string }>).find(
    (c) => norm(c.name) === norm(name),
  );
  if (dup) {
    throw new Error(
      `Ya tienes una categoría llamada «${dup.name}». Usa otro nombre o edita la que ya existe.`,
    );
  }

  const { error } = await admin.from("product_categories").insert({
    company_id: session.company_id,
    name,
    default_kind,
    is_active: true,
    created_by: session.user_id,
  } as never);
  if (error) {
    // Backstop por si dos usuarios crean a la vez el mismo nombre.
    if ((error as { code?: string }).code === "23505") {
      throw new Error(
        `Ya tienes una categoría llamada «${name}». Usa otro nombre o edita la que ya existe.`,
      );
    }
    throw error;
  }
  revalidatePath("/configuracion/productos");
}

/**
 * Edita una categoría existente. Solo admin. Aditivo: cualquier campo
 * undefined no se toca. parent_id no puede ser la propia categoría.
 */
export async function updateCategoryAction(
  id: string,
  input: {
    name?: string;
    default_kind?: ProductKind;
    description?: string | null;
    icon?: string | null;
    sort_order?: number;
    is_active?: boolean;
    parent_id?: string | null;
  },
): Promise<ProductActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id || !session.roles.includes("company_admin"))
      return { ok: false, error: "Solo el administrador puede modificar categorías." };
    if (input.parent_id && input.parent_id === id)
      return { ok: false, error: "Una categoría no puede ser su propia categoría padre." };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminCheck = createAdminClient() as any;

    // Anti-ciclo: el padre elegido no puede ser un descendiente de esta categoría
    // (evita bucles A→B→A que romperían las consultas de jerarquía).
    if (input.parent_id) {
      const { data: allCats } = await adminCheck
        .from("product_categories")
        .select("id, parent_id")
        .eq("company_id", session.company_id);
      const parentOf = new Map(
        ((allCats ?? []) as Array<{ id: string; parent_id: string | null }>).map((c) => [
          c.id,
          c.parent_id,
        ]),
      );
      let cursor: string | null | undefined = input.parent_id;
      let guard = 0;
      while (cursor && guard < 100) {
        if (cursor === id)
          return {
            ok: false,
            error: "No puedes poner como padre una subcategoría de esta misma categoría.",
          };
        cursor = parentOf.get(cursor);
        guard += 1;
      }
    }

    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) payload[k] = v;
    }
    if (Object.keys(payload).length === 0) return { ok: true };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_categories")
      .update(payload)
      .eq("id", id)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/configuracion/productos");
    revalidatePath("/productos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * "Borra" una categoría. Por seguridad con datos vivos:
 *   - Si tiene productos, atributos o subcategorías colgando → NO borra;
 *     la desactiva (is_active=false) y avisa.
 *   - Si está limpia → borrado duro.
 * Solo admin.
 */
export async function deleteCategoryAction(
  id: string,
): Promise<{ ok: true; deactivated: boolean } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id || !session.roles.includes("company_admin"))
      return { ok: false, error: "Solo el administrador puede borrar categorías." };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const [prod, attr, children, bridge] = await Promise.all([
      admin
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("category_id", id)
        .is("deleted_at", null),
      admin.from("product_attributes").select("id", { count: "exact", head: true }).eq("category_id", id),
      admin.from("product_categories").select("id", { count: "exact", head: true }).eq("parent_id", id),
      // Atributos que usan esta categoría como EXTRA (tabla puente). Defensivo:
      // si la tabla no existe todavía, lo tratamos como 0.
      admin
        .from("product_attribute_categories")
        .select("attribute_id", { count: "exact", head: true })
        .eq("category_id", id),
    ]);
    const inUse =
      (prod.count ?? 0) > 0 ||
      (attr.count ?? 0) > 0 ||
      (children.count ?? 0) > 0 ||
      (bridge.count ?? 0) > 0;

    if (inUse) {
      const { error } = await admin
        .from("product_categories")
        .update({ is_active: false })
        .eq("id", id)
        .eq("company_id", session.company_id);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/configuracion/productos");
      return { ok: true, deactivated: true };
    }

    const { error } = await admin
      .from("product_categories")
      .delete()
      .eq("id", id)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/configuracion/productos");
    return { ok: true, deactivated: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
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

  // Roles adicionales elegidos en el alta (Fase B). Vienen como JSON array de
  // strings. Defensivo: si la columna roles no existe aún, se ignora.
  const rolesRaw = formData.get("roles");
  if (typeof rolesRaw === "string" && rolesRaw.trim().length > 0) {
    try {
      const chosen = (JSON.parse(rolesRaw) as string[]).filter((r) =>
        (PRODUCT_ROLES as readonly string[]).includes(r),
      );
      if (chosen.length > 0) {
        const { error: rErr } = await admin
          .from("products")
          .update({ roles: chosen })
          .eq("id", productId);
        if (rErr && !/roles/i.test(rErr.message ?? "")) {
          console.error("[create product] roles update:", rErr.message);
        }
      }
    } catch (e) {
      console.error("[create product] bad roles JSON:", e);
    }
  }

  revalidatePath("/productos");
  redirect(`/productos/${productId}` as never);
}

/**
 * Wrapper Safe de createProductAction: captura los errores de validación
 * SERVER-SIDE y los devuelve como dato `{ok:false,error}` (en producción
 * Next.js redacta el mensaje de un Error lanzado, ver feedback_server_action_errors).
 * El éxito hace redirect (lanza NEXT_REDIRECT), que dejamos pasar.
 */
export async function createProductSafeAction(
  formData: FormData,
): Promise<{ ok: false; error: string }> {
  try {
    await createProductAction(formData);
    return { ok: false, error: "" }; // inalcanzable: createProductAction redirige en éxito
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "digest" in e &&
      String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw e;
    }
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export type ProductActionResult = { ok: true } | { ok: false; error: string };

/**
 * Actualiza datos generales y costes admin de un producto. Solo admin.
 *
 * También acepta los campos nuevos de Fase 1 (Plan Productos v2):
 *   tags, marketing_claim, youtube_url, qr_target_url, barcode_ean13,
 *   country_of_origin, manufacturer_name, manufacturer_model,
 *   warranty_months_general/electronics/body, discontinued_at,
 *   replaced_by_product_id, installation_diagram_url,
 *   datasheet_color_accent.
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
    installation_manual_url?: string | null;
    installation_notes?: string | null;
    // Campos nuevos Fase 1
    tags?: string[] | null;
    marketing_claim?: string | null;
    youtube_url?: string | null;
    qr_target_url?: string | null;
    barcode_ean13?: string | null;
    country_of_origin?: string | null;
    manufacturer_name?: string | null;
    manufacturer_model?: string | null;
    warranty_months_general?: number | null;
    warranty_months_electronics?: number | null;
    warranty_months_body?: number | null;
    discontinued_at?: string | null;
    replaced_by_product_id?: string | null;
    installation_diagram_url?: string | null;
    datasheet_color_accent?: string | null;
    // Fase B (Plan FIX 2026-06-09): papeles adicionales del producto.
    roles?: string[] | null;
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
        // Fase 1 Plan Productos v2
        "tags",
        "marketing_claim",
        "youtube_url",
        "qr_target_url",
        "barcode_ean13",
        "country_of_origin",
        "manufacturer_name",
        "manufacturer_model",
        "warranty_months_general",
        "warranty_months_electronics",
        "warranty_months_body",
        "discontinued_at",
        "replaced_by_product_id",
        "installation_diagram_url",
        "datasheet_color_accent",
        "roles",
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

// =================== Safe wrappers ===================

export async function cloneGlobalCategorySafeAction(
  globalCategoryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await cloneGlobalCategoryAction(globalCategoryId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function createCategorySafeAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createCategoryAction(formData);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export type DeleteProductResult =
  | { ok: true }
  | { ok: false; error: string; reason?: "history" | "active" };

/**
 * Borra un producto. SOLO admin (nivel 1). Regla (decisión 2026-06-12):
 *  - Si el producto NO tiene NINGÚN rastro real (stock/movimientos, equipo
 *    instalado en cliente, línea de contrato/propuesta, compra, prueba) → se
 *    BORRA de verdad (era un alta por error). La config pura (precios,
 *    atributos, docs, filtros) NO impide borrar: se borra en cascada.
 *  - Si tiene algún rastro → NO se borra (se devuelve reason:'history' para
 *    sugerir desactivarlo y conservar el histórico).
 */
export async function deleteProductAction(
  productId: string,
): Promise<DeleteProductResult> {
  try {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    return { ok: false, error: "Solo el admin de empresa puede borrar productos" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Verificar pertenencia del producto a la empresa + su estado.
  const { data: prod } = await admin
    .from("products")
    .select("id, is_active")
    .eq("id", productId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!prod) return { ok: false, error: "Producto no encontrado o no pertenece a tu empresa" };

  // REGLA (2026-06-12): solo se puede borrar un producto INACTIVO. El borrado es
  // siempre un acto deliberado en dos pasos (desactivar → borrar), así nunca se
  // pierde por accidente un producto en uso.
  if ((prod as { is_active: boolean }).is_active) {
    return {
      ok: false,
      reason: "active",
      error:
        "Solo puedes borrar un producto que esté inactivo. Desactívalo primero (botón «Desactivar») y luego bórralo.",
    };
  }

  // Tablas de HISTORIAL que impiden el borrado (cuenta por product_id, que es
  // único de esta empresa). Conservador: si una comprobación falla por algo
  // distinto a "tabla inexistente", bloqueamos (no borramos a ciegas).
  const HISTORY_TABLES = [
    "warehouse_stock",
    "stock_movements",
    "customer_equipment",
    "installation_items",
    "contract_items",
    "proposal_items",
    "purchase_items",
    "free_trial_items",
  ];
  for (const t of HISTORY_TABLES) {
    // Contamos por product_id (columna presente en TODAS estas tablas; algunas
    // como warehouse_stock no tienen columna `id`, por eso no la usamos).
    const { count, error } = await admin
      .from(t)
      .select("product_id", { count: "exact", head: true })
      .eq("product_id", productId);
    // Si la comprobación falla por lo que sea (tabla ausente, columna distinta…)
    // NO bloqueamos: el DELETE final, con sus claves foráneas RESTRICT, es la red
    // de seguridad real y devolverá el motivo exacto si hay rastro de verdad.
    if (error) continue;
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        reason: "history",
        error:
          "Este producto tiene historial (stock, movimientos, equipos instalados, contratos, compras o pruebas). No se puede borrar: desactívalo para conservar el histórico.",
      };
    }
  }

  // Sin historial → borrar config hija (best-effort) y el producto.
  const CONFIG_TABLES = [
    "product_pricing_plans",
    "product_attribute_values",
    "product_attribute_categories",
    "product_documents",
  ];
  for (const t of CONFIG_TABLES) {
    try {
      await admin.from(t).delete().eq("product_id", productId).eq("company_id", session.company_id);
    } catch {
      /* best-effort: si la tabla no existe o no tiene company_id, seguimos */
    }
  }
  const { error: delErr } = await admin
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("company_id", session.company_id);
  if (delErr) {
    // Si falla por FK (algún rastro no contemplado), sugerimos desactivar e
    // incluimos el detalle técnico para poder localizar la tabla que lo retiene.
    return {
      ok: false,
      reason: "history",
      error: `No se pudo borrar: el producto está referenciado en otro sitio y se conserva el historial. Desactívalo en su lugar. (Detalle: ${delErr.message})`,
    };
  }
  revalidatePath("/productos");
  revalidatePath("/configuracion/productos");
  return { ok: true };
  } catch (e) {
    // Nunca dejar el botón colgado sin mensaje: cualquier excepción se reporta.
    console.error("[deleteProductAction] excepción:", e);
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Error al borrar: ${e.message}`
          : "Error inesperado al borrar el producto",
    };
  }
}

/**
 * Activa o desactiva un producto. SOLO admin de empresa (nivel 1) o superadmin.
 * Desactivar = sacarlo de catálogos/calculadora/nuevas ventas sin perder nada.
 * Es el paso previo obligatorio para poder BORRARLO (ver deleteProductAction).
 */
export async function setProductActiveAction(
  productId: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    return {
      ok: false,
      error: "Solo el admin de empresa puede activar o desactivar productos",
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("products")
    .update({ is_active: active })
    .eq("id", productId)
    .eq("company_id", session.company_id) // anti cross-tenant
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "Producto no encontrado o no pertenece a tu empresa" };
  }
  revalidatePath("/productos");
  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}
