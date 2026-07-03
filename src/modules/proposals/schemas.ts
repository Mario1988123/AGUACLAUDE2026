import { z } from "zod";
import { zBoolean } from "@/shared/lib/zod-friendly";

export const PROPOSAL_STATUS = [
  "draft",
  "pending_approval",
  "active",
  "sent",
  "accepted",
  "rejected",
  "superseded",
  "expired",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Borrador",
  pending_approval: "Pendiente aprobación",
  active: "Activa",
  sent: "Enviada al cliente",
  accepted: "Aceptada",
  rejected: "Rechazada",
  superseded: "Reemplazada",
  expired: "Caducada",
};

export const STATUS_VARIANT: Record<
  ProposalStatus,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  draft: "secondary",
  pending_approval: "warning",
  active: "default",
  sent: "default",
  accepted: "success",
  rejected: "destructive",
  superseded: "outline",
  expired: "outline",
};

export const PLAN_TYPE_LABEL: Record<"cash" | "rental" | "renting", string> = {
  cash: "Contado",
  rental: "Alquiler",
  renting: "Renting",
};

export const PERIODICITY_OPTIONS = [3, 6, 9, 12, 18, 24] as const;

const proposalItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).default(1),
  unit_price_cents: z.coerce.number().int().min(0),
  installation_included: zBoolean().default(true),
  installation_price_cents: z.coerce.number().int().min(0).nullable().default(null),
  maintenance_included: zBoolean().default(false),
  maintenance_until_date: z.string().nullable().default(null),
  maintenance_price_cents: z.coerce.number().int().min(0).nullable().default(null),
  maintenance_periodicity_months: z.coerce.number().int().nullable().default(null),
  deposit_cents: z.coerce.number().int().min(0).nullable().default(null),
  charge_first_payment_now: zBoolean().default(false),
  /**
   * Pack: índice (dentro de este array de items) del EQUIPO PRINCIPAL del que
   * cuelga este extra. null = línea principal o suelta. Se resuelve a
   * parent_item_id tras insertar (no conocemos los ids en cliente).
   */
  parent_index: z.coerce.number().int().min(0).nullable().default(null),
});

export const proposalCreateSchema = z
  .object({
    customer_id: z.string().uuid().optional(),
    lead_id: z.string().uuid().optional(),
    chosen_plan_type: z.enum(["cash", "rental", "renting"]),
    chosen_duration_months: z.coerce.number().int().min(1).nullable().default(null),
    validity_until: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    items: z.array(proposalItemSchema).min(1, "Añade al menos un producto"),
    /**
     * Si true, la propuesta se acepta automáticamente y se genera el
     * contrato. Caso "cliente acepta de palabra sin propuesta formal".
     */
    auto_accept: zBoolean().default(false),
    // Datos de financiera (Fase 4 — solo aplicables cuando plan = renting).
    financier_id: z.string().uuid().optional().nullable(),
    financier_payment_cents: z.coerce.number().int().min(0).optional().nullable(),
    financier_term_months: z.coerce.number().int().min(1).optional().nullable(),
    financier_coefficient: z.coerce.number().positive().optional().nullable(),
    financier_residual_cents: z.coerce.number().int().min(0).optional().nullable(),
    financier_reserve_cents: z.coerce.number().int().min(0).optional().nullable(),
  })
  .refine((v) => Boolean(v.customer_id) !== Boolean(v.lead_id), {
    message: "La propuesta debe estar asociada a un cliente o a un lead, no ambos",
  });

export type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;
export type ProposalItemInput = z.infer<typeof proposalItemSchema>;
