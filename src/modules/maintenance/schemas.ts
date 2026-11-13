import { z } from "zod";

export const maintenanceCreateSchema = z.object({
  customer_id: z.string().uuid(),
  customer_equipment_id: z.string().uuid().optional(),
  // Dirección concreta del mantenimiento. Forms mandan null explícito si no se
  // elige => .nullish() (no .optional()). Si llega null/undefined y hay equipo,
  // el server pone por defecto la dirección del equipo.
  address_id: z.string().uuid().nullish(),
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
  // Alcance del mantenimiento de ósmosis (plan modelo de equipo, decisión 17).
  // Obligatorio en ósmosis (lo exige el servidor); en fuentes se ignora.
  alcance: z.enum(["solo_filtros", "filtros_membrana"]).nullish(),
  alcance_motivo: z.string().max(500).nullish(),
  // Cobro de la visita (plan mantenimientos incluidos, §2.1). Solo cuando la
  // visita se cobra (k > N) o hay diferencia de membrana; el servidor decide.
  // `alcance` hace de tarifa. El técnico solo cobra en efectivo o tarjeta.
  cobro: z
    .object({
      cobrado: z.boolean(),
      metodo: z.enum(["cash", "card"]).nullish(),
      cents: z.number().int().min(0).max(1_000_000).nullish(),
      motivo: z.string().max(500).nullish(),
    })
    .nullish(),
  replaced_items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .default([]),
});
