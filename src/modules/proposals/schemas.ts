import { z } from "zod";

export const PROPOSAL_STATUS = [
  "draft",
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
  active: "Activa",
  sent: "Enviada",
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
  active: "default",
  sent: "warning",
  accepted: "success",
  rejected: "destructive",
  superseded: "outline",
  expired: "outline",
};

export const proposalCreateSchema = z
  .object({
    customer_id: z.string().uuid().optional(),
    lead_id: z.string().uuid().optional(),
    validity_until: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    items: z
      .array(
        z.object({
          product_id: z.string().uuid(),
          quantity: z.coerce.number().int().min(1).default(1),
          unit_price_cents: z.coerce.number().int().min(0),
        }),
      )
      .min(1, "Añade al menos un producto"),
  })
  .refine((v) => Boolean(v.customer_id) !== Boolean(v.lead_id), {
    message: "La propuesta debe estar asociada a un cliente o a un lead, no ambos",
  });

export type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;
