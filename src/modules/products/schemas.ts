import { z } from "zod";
import { zBoolean } from "@/shared/lib/zod-friendly";

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
  cost_cents: z.coerce.number().int().min(0).optional().nullable(),
  supplier_price_cents: z.coerce.number().int().min(0).optional().nullable(),
  dim_width_mm: z.coerce.number().int().min(0).optional().nullable(),
  dim_height_mm: z.coerce.number().int().min(0).optional().nullable(),
  dim_depth_mm: z.coerce.number().int().min(0).optional().nullable(),
  weight_grams: z.coerce.number().int().min(0).optional().nullable(),
  stock_managed: zBoolean().default(true),
  stock_min: z.coerce.number().int().min(0).default(0),
  // Plan inicial cash
  cash_total_cents: z.coerce.number().int().min(0).optional().nullable(),
  cash_min_authorized_cents: z.coerce.number().int().min(0).optional().nullable(),
  cash_absolute_min_cents: z.coerce.number().int().min(0).optional().nullable(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
