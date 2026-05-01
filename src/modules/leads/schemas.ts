import { z } from "zod";

export const PARTY_KIND = ["individual", "company"] as const;
export const LEAD_STATUS = [
  "new",
  "contacted",
  "proposal_created",
  "proposal_sent",
  "free_trial_proposed",
  "converted",
  "lost",
  "expired",
] as const;
export const LEAD_ORIGIN = [
  "web",
  "referral",
  "door_to_door",
  "tmk",
  "cold_call",
  "event",
  "social",
  "other",
] as const;
export const LEAD_POTENTIAL = ["A", "B", "C", "unknown"] as const;

export const STATUS_LABEL: Record<(typeof LEAD_STATUS)[number], string> = {
  new: "Nuevo",
  contacted: "Contactado",
  proposal_created: "Propuesta creada",
  proposal_sent: "Propuesta enviada",
  free_trial_proposed: "Prueba propuesta",
  converted: "Convertido",
  lost: "Venta perdida",
  expired: "Caducado",
};

export const ORIGIN_LABEL: Record<(typeof LEAD_ORIGIN)[number], string> = {
  web: "Web",
  referral: "Referido",
  door_to_door: "Puerta fría",
  tmk: "Telemarketing",
  cold_call: "Llamada fría",
  event: "Evento",
  social: "Redes sociales",
  other: "Otro",
};

export const STATUS_VARIANT: Record<
  (typeof LEAD_STATUS)[number],
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  new: "default",
  contacted: "warning",
  proposal_created: "secondary",
  proposal_sent: "secondary",
  free_trial_proposed: "secondary",
  converted: "success",
  lost: "destructive",
  expired: "outline",
};

export const leadCreateSchema = z
  .object({
    party_kind: z.enum(PARTY_KIND),
    legal_name: z.string().optional().default(""),
    trade_name: z.string().optional().default(""),
    first_name: z.string().optional().default(""),
    last_name: z.string().optional().default(""),
    email: z.string().email("Email no válido").optional().or(z.literal("")),
    phone_primary: z.string().optional().default(""),
    phone_company: z.string().optional().default(""),
    tax_id: z.string().optional().default(""),
    origin: z.enum(LEAD_ORIGIN).default("other"),
    potential: z.enum(LEAD_POTENTIAL).default("unknown"),
    notes: z.string().optional().default(""),
  })
  .refine(
    (v) => {
      if (v.party_kind === "company") return Boolean(v.legal_name?.trim());
      return Boolean(v.first_name?.trim());
    },
    { message: "Nombre obligatorio según tipo (razón social o nombre)", path: ["legal_name"] },
  );

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
