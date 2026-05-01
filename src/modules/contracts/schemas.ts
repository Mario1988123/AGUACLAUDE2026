import { z } from "zod";

export const CONTRACT_STATUS = [
  "draft",
  "pending_data",
  "pending_signature",
  "signed",
  "active",
  "completed",
  "cancelled",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[number];

export const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "Borrador",
  pending_data: "Pendiente datos",
  pending_signature: "Pendiente firma",
  signed: "Firmado",
  active: "Activo",
  completed: "Completado",
  cancelled: "Cancelado",
};

export const STATUS_VARIANT: Record<
  ContractStatus,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  draft: "secondary",
  pending_data: "warning",
  pending_signature: "warning",
  signed: "success",
  active: "success",
  completed: "outline",
  cancelled: "destructive",
};

export const PLAN_TYPE_LABEL: Record<string, string> = {
  cash: "Contado",
  renting: "Renting",
  rental: "Alquiler",
};

export const contractCreateSchema = z.object({
  customer_id: z.string().uuid(),
  source_proposal_id: z.string().uuid().optional(),
  plan_type: z.enum(["cash", "renting", "rental"]).default("cash"),
  duration_months: z.coerce.number().int().min(1).optional().nullable(),
  total_cash_cents: z.coerce.number().int().min(0).optional().nullable(),
  monthly_cents: z.coerce.number().int().min(0).optional().nullable(),
  permanence_months: z.coerce.number().int().min(0).optional().nullable(),
  maintenance_included: z.coerce.boolean().default(false),
  maintenance_periodicity_months: z.coerce.number().int().min(1).optional().nullable(),
  maintenance_months_included: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().optional().default(""),
});
export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
