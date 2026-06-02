import { z } from "zod";

export const PRODUCT_KIND = ["equipment", "spare_part", "accessory", "consumable", "service"] as const;
export const KIND_LABEL: Record<(typeof PRODUCT_KIND)[number], string> = {
  equipment: "Equipo",
  spare_part: "Recambio",
  accessory: "Accesorio",
  consumable: "Consumible",
  service: "Servicio",
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
  stock_managed: z.coerce.boolean().default(true),
  stock_min: z.coerce.number().int().min(0).default(0),
  // Plan inicial cash
  cash_total_cents: z.coerce.number().int().min(0).optional().nullable(),
  cash_min_authorized_cents: z.coerce.number().int().min(0).optional().nullable(),
  cash_absolute_min_cents: z.coerce.number().int().min(0).optional().nullable(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
