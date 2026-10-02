import { z } from "zod";
import { zBoolean, zOptionalInt } from "@/shared/lib/zod-friendly";

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
  // Aclaración explícita: el contrato está firmado pero le faltan datos
  // críticos (típicamente IBAN real — se firmó con ES00 placeholder).
  // Hasta validar el IBAN no se considera definitivo legalmente.
  pending_data: "Firmado · faltan datos",
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
  // zOptionalInt: un campo vacío es "sin dato" (null), no 0 (Number("") = 0).
  duration_months: zOptionalInt(1),
  total_cash_cents: zOptionalInt(0),
  monthly_cents: zOptionalInt(0),
  permanence_months: zOptionalInt(0),
  maintenance_included: zBoolean().default(false),
  maintenance_periodicity_months: zOptionalInt(1),
  maintenance_months_included: zOptionalInt(0),
  notes: z.string().optional().default(""),
});
export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
