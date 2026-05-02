import { z } from "zod";

export const maintenanceCreateSchema = z.object({
  customer_id: z.string().uuid(),
  customer_equipment_id: z.string().uuid().optional(),
  contract_id: z.string().uuid().optional(),
  kind: z.enum(["contracted", "one_off", "warranty"]).default("contracted"),
  scheduled_at: z.string().min(1),
  technician_user_id: z.string().uuid().optional(),
  is_charged: z.boolean().default(false),
  charge_cents: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().optional().default(""),
});

export const completeMaintenanceSchema = z.object({
  id: z.string().uuid(),
  notes: z.string().optional(),
  replaced_items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .default([]),
});
