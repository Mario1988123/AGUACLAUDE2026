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

export const startInstallationSchema = z.object({
  id: z.string().uuid(),
  geo_lat: z.number().optional(),
  geo_lng: z.number().optional(),
});

export const installationStepSchema = z.object({
  installation_id: z.string().uuid(),
  has_previous_damage: z.boolean().optional(),
  needs_countertop_drilling: z.boolean().optional(),
  notes: z.string().optional(),
});

export const completeInstallationSchema = z.object({
  id: z.string().uuid(),
  geo_lat: z.number().optional(),
  geo_lng: z.number().optional(),
  notes: z.string().optional(),
});
