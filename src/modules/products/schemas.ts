import { z } from "zod";
import { zBoolean, zOptionalInt, zIntDefault, validatePatch } from "@/shared/lib/zod-friendly";

export const PRODUCT_KIND = ["equipment", "spare_part", "accessory", "consumable", "service"] as const;
export const KIND_LABEL: Record<(typeof PRODUCT_KIND)[number], string> = {
  equipment: "Equipo",
  spare_part: "Recambio",
  accessory: "Accesorio",
  consumable: "Consumible",
  service: "Servicio",
};

/**
 * Papeles ADICIONALES de un producto (además de su `kind` principal). Un mismo
 * producto puede tener varios a la vez (ej. la grifería: vendible suelta Y extra
 * del configurador). Ver migración 20260609110000_products_roles.sql.
 */
export const PRODUCT_ROLES = [
  "sellable_standalone",
  "configurator_extra",
  "spare_part_role",
  "accessory_role",
] as const;
export type ProductRole = (typeof PRODUCT_ROLES)[number];
export const ROLE_LABEL: Record<ProductRole, string> = {
  sellable_standalone: "Se vende suelto",
  configurator_extra: "Extra del configurador",
  spare_part_role: "También es recambio",
  accessory_role: "Es un accesorio",
};
export const ROLE_HELP: Record<ProductRole, string> = {
  sellable_standalone: "Aparece en el catálogo y se puede añadir a propuestas por sí mismo.",
  configurator_extra: "Se puede ofrecer como extra al configurar otro equipo (ej. grifería de una ósmosis).",
  spare_part_role: "Sirve como recambio compatible con uno o varios equipos.",
  accessory_role: "Complemento de otro producto.",
};

export const productCreateSchema = z.object({
  name: z.string().min(2, "Nombre obligatorio"),
  kind: z.enum(PRODUCT_KIND).default("equipment"),
  // El FormData manda string vacío "" cuando no hay categoría elegida —
  // .uuid() rechaza "" con "Invalid uuid". Preprocess que normaliza "" → undefined
  // y permite uuid válido o null/undefined. La regla "Zod nullish no optional"
  // de memoria aplica aquí.
  category_id: z
    .preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().uuid().optional(),
    )
    .optional(),
  internal_reference: z.string().optional().default(""),
  supplier_reference: z.string().optional().default(""),
  short_description: z.string().optional().default(""),
  long_description: z.string().optional().default(""),
  cost_cents: zOptionalInt(),
  supplier_price_cents: zOptionalInt(),
  // La tabla exige > 0 si hay valor (CHECK). Vacío = sin dato (null), no 0.
  dim_width_mm: zOptionalInt(1, "El ancho debe ser mayor que 0"),
  dim_height_mm: zOptionalInt(1, "El alto debe ser mayor que 0"),
  dim_depth_mm: zOptionalInt(1, "El fondo debe ser mayor que 0"),
  weight_grams: zOptionalInt(1, "El peso debe ser mayor que 0"),
  stock_managed: zBoolean().default(true),
  stock_min: zIntDefault(0, 0, "El stock mínimo no puede ser negativo"),
  // Plan inicial cash
  // Vacío = null, para que el `??` de la acción herede el precio total.
  // Antes "" llegaba como 0 y el mínimo autorizado quedaba en 0 €.
  cash_total_cents: zOptionalInt(),
  cash_min_authorized_cents: zOptionalInt(),
  cash_absolute_min_cents: zOptionalInt(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;

/**
 * Campos numéricos que admite `updateProductAction`, con los mismos límites
 * que los CHECK de la tabla `products` (auditoría 2026-10-01 I8: la edición
 * no validaba nada y un "0" en una medida rompía con
 * products_dim_depth_mm_check; un "12.5" con "invalid input syntax for type
 * integer"). Vacío/null = sin dato, salvo stock_min, que es NOT NULL y se
 * normaliza a 0 en `validateProductPatch`.
 */
const PRODUCT_PATCH_NUMERIC = {
  dim_width_mm: zOptionalInt(1, "Tiene que ser mayor que 0 (o déjalo en blanco)"),
  dim_height_mm: zOptionalInt(1, "Tiene que ser mayor que 0 (o déjalo en blanco)"),
  dim_depth_mm: zOptionalInt(1, "Tiene que ser mayor que 0 (o déjalo en blanco)"),
  weight_grams: zOptionalInt(1, "Tiene que ser mayor que 0 (o déjalo en blanco)"),
  stock_min: zOptionalInt(0, "No puede ser negativo"),
  stock_max: zOptionalInt(0, "No puede ser negativo"),
  lead_time_days: zOptionalInt(0, "No puede ser negativo"),
  warranty_months_general: zOptionalInt(0, "No puede ser negativa"),
  warranty_months_electronics: zOptionalInt(0, "No puede ser negativa"),
  warranty_months_body: zOptionalInt(0, "No puede ser negativa"),
} as const;

const PRODUCT_PATCH_LABELS: Record<string, string> = {
  dim_width_mm: "Ancho (mm)",
  dim_height_mm: "Alto (mm)",
  dim_depth_mm: "Profundidad (mm)",
  weight_grams: "Peso (g)",
  stock_min: "Stock mínimo",
  stock_max: "Stock máximo",
  lead_time_days: "Plazo de entrega (días)",
  warranty_months_general: "Garantía general (meses)",
  warranty_months_electronics: "Garantía electrónica (meses)",
  warranty_months_body: "Garantía del cuerpo (meses)",
};

/**
 * Valida y normaliza los campos numéricos PRESENTES de un parche de producto.
 * Las claves ausentes no se tocan. Devuelve `[parche, null]` o `[null, error]`.
 */
export function validateProductPatch<T extends Record<string, unknown>>(
  input: T,
): [T, null] | [null, string] {
  const [patch, err] = validatePatch(input, PRODUCT_PATCH_NUMERIC, PRODUCT_PATCH_LABELS);
  if (err !== null) return [null, err];
  // stock_min es NOT NULL DEFAULT 0: "sin dato" = 0.
  if ("stock_min" in patch && patch.stock_min === null) {
    (patch as Record<string, unknown>).stock_min = 0;
  }
  return [patch, null];
}

/**
 * Coherencia del plan de contado del alta (auditoría 2026-10-01 I40). La
 * tabla exige absoluto <= mínimo autorizado <= total
 * (product_pricing_plans_check / _check1). Antes el insert del plan fallaba
 * sin mirar el error y el producto quedaba creado SIN precio y sin aviso.
 * Devuelve el mensaje para el usuario o null si cuadra (o no hay precio).
 */
export function cashPlanError(input: {
  cash_total_cents: number | null | undefined;
  cash_min_authorized_cents: number | null | undefined;
  cash_absolute_min_cents: number | null | undefined;
}): string | null {
  const total = input.cash_total_cents;
  if (total == null || total <= 0) return null;
  const minAuth = input.cash_min_authorized_cents ?? total;
  const minAbs = input.cash_absolute_min_cents ?? minAuth;
  if (minAuth > total) {
    return "El mínimo autorizado no puede ser mayor que el precio de contado.";
  }
  if (minAbs > minAuth) {
    return "El mínimo absoluto no puede ser mayor que el mínimo autorizado.";
  }
  return null;
}
