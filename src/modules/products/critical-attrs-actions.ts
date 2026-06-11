"use server";
/**
 * Server actions para el aviso de "atributos críticos faltantes" en la
 * ficha técnica de un producto. Solo lo ve nivel 1 (admin/superadmin).
 *
 * Comportamiento:
 *   - Lee product_attributes locales con `is_critical=true` para la categoría
 *     del producto (la app ya importa atributos sugeridos del seed).
 *   - Cruza con product_attribute_values: marca como "faltante" si no hay
 *     fila O si el valor es vacío.
 *   - Permite al admin marcar el aviso como visto (insert en
 *     product_alerts_dismissed con alert_key = 'missing_critical_attributes').
 *   - Si el usuario lo descartó, devolvemos isDismissed = true para que la UI
 *     lo oculte hasta que admin lo reactive desde otro sitio.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { isProductEditor } from "./permissions";

export interface CriticalAttributeMissing {
  attribute_id: string;
  attribute_name: string;
  unit: string | null;
}

export interface CriticalAttributesState {
  isDismissed: boolean;
  /** Solo para admin (nivel 1). Para nivel 2-3 siempre devolvemos []. */
  missing: CriticalAttributeMissing[];
}

const ALERT_KEY = "missing_critical_attributes";

export async function getCriticalAttributesState(
  productId: string,
): Promise<CriticalAttributesState> {
  const session = await requireSession();
  if (!session.company_id) return { isDismissed: true, missing: [] };
  // Esta info es solo para nivel 1.
  if (!isProductEditor(session)) return { isDismissed: true, missing: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Producto + categoría
  const { data: prod } = await admin
    .from("products")
    .select("id, category_id, company_id")
    .eq("id", productId)
    .maybeSingle();
  if (!prod || (prod as { company_id: string }).company_id !== session.company_id) {
    return { isDismissed: true, missing: [] };
  }
  const catId = (prod as { category_id: string | null }).category_id;
  if (!catId) return { isDismissed: true, missing: [] };

  // 2) Atributos críticos locales de esa categoría (defensivo con is_critical)
  // data_type vive en product_attributes (NO en product_attribute_values).
  let criticalAttrs: Array<{ id: string; name: string; unit: string | null; data_type: string }> = [];
  try {
    const { data, error } = await admin
      .from("product_attributes")
      .select("id, name, unit, data_type, is_critical")
      .eq("company_id", session.company_id)
      .eq("category_id", catId)
      .eq("is_critical", true);
    if (error && /is_critical/i.test(error.message ?? "")) {
      // Columna aún no aplicada → no hay críticos definidos. No avisamos.
      return { isDismissed: true, missing: [] };
    }
    criticalAttrs = ((data ?? []) as Array<{
      id: string;
      name: string;
      unit: string | null;
      data_type: string | null;
      is_critical: boolean;
    }>).map((a) => ({ id: a.id, name: a.name, unit: a.unit, data_type: a.data_type ?? "text" }));
  } catch {
    return { isDismissed: true, missing: [] };
  }

  if (criticalAttrs.length === 0) return { isDismissed: true, missing: [] };

  // 3) Valores existentes
  const { data: values } = await admin
    .from("product_attribute_values")
    .select(
      // product_attribute_values NO tiene data_type (vive en product_attributes).
      "attribute_id, value_text, value_number, value_boolean, is_visible",
    )
    .eq("product_id", productId);
  type V = {
    attribute_id: string;
    value_text: string | null;
    value_number: number | null;
    value_boolean: boolean | null;
    is_visible: boolean;
  };
  // data_type por atributo, desde criticalAttrs (product_attributes).
  const dataTypeById = new Map(criticalAttrs.map((a) => [a.id, a.data_type]));
  const filledMap = new Map<string, V>();
  for (const v of (values ?? []) as V[]) {
    const dt = dataTypeById.get(v.attribute_id) ?? "text";
    const hasValue =
      dt === "boolean"
        ? v.value_boolean != null
        : dt === "number" || dt === "dimension"
          ? v.value_number != null
          : v.value_text != null && v.value_text.trim().length > 0;
    if (hasValue && v.is_visible) filledMap.set(v.attribute_id, v);
  }

  const missing = criticalAttrs
    .filter((a) => !filledMap.has(a.id))
    .map((a) => ({ attribute_id: a.id, attribute_name: a.name, unit: a.unit }));

  // 4) Saber si el usuario actual ya descartó el aviso
  let isDismissed = false;
  try {
    const { data: dismissed } = await admin
      .from("product_alerts_dismissed")
      .select("id")
      .eq("product_id", productId)
      .eq("user_id", session.user_id)
      .eq("alert_key", ALERT_KEY)
      .maybeSingle();
    isDismissed = Boolean(dismissed);
  } catch {
    /* fail-soft */
  }

  return { isDismissed, missing };
}

export async function dismissCriticalAttributesAlertAction(
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: "Solo admin" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("product_alerts_dismissed").insert({
      company_id: session.company_id,
      product_id: productId,
      user_id: session.user_id,
      alert_key: ALERT_KEY,
    });
    if (error && (error as { code?: string }).code !== "23505") {
      return { ok: false, error: error.message };
    }
    revalidatePath(`/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
