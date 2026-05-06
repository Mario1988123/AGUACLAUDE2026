import { z } from "zod";

export const installationCreateFromContractSchema = z.object({
  contract_id: z.string().uuid(),
  scheduled_at: z.string().optional(),
  installer_user_id: z.string().uuid().optional(),
  source_warehouse_id: z.string().uuid().optional(),
});

export const installationUpdateSchema = z.object({
  id: z.string().uuid(),
  scheduled_at: z.string().optional(),
  installer_user_id: z.string().uuid().optional(),
  preferred_time_slot: z.string().optional(),
});

// Nota: usamos `.nullish()` (acepta null y undefined) porque el wizard
// envía `null` explícito cuando no hay GPS / sin notas. Antes con
// `.optional()` (solo undefined) Zod rechazaba el null y la acción
// tiraba digest opaco al cerrar la instalación.
export const startInstallationSchema = z.object({
  id: z.string().uuid(),
  geo_lat: z.number().nullish(),
  geo_lng: z.number().nullish(),
});

export const installationStepSchema = z.object({
  installation_id: z.string().uuid(),
  has_previous_damage: z.boolean().nullish(),
  needs_countertop_drilling: z.boolean().nullish(),
  notes: z.string().nullish(),
});

export const completeInstallationSchema = z.object({
  id: z.string().uuid(),
  geo_lat: z.number().nullish(),
  geo_lng: z.number().nullish(),
  notes: z.string().nullish(),
  /** Fecha en la que arranca el servicio del contrato (YYYY-MM-DD).
   * Si es hoy o pasada → contrato pasa a active inmediatamente.
   * Si es futura → queda en signed, el cron lo activa al llegar el día. */
  service_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
