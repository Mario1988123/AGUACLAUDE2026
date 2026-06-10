import { z } from "zod";
import { zBoolean } from "@/shared/lib/zod-friendly";
import {
  validateSpanishPhone,
  validateSpanishPostalCode,
} from "@/shared/lib/validations/spanish";

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
    // zBoolean (no z.coerce.boolean): Boolean("false") === true rompía el
    // alta de lead de EMPRESA (lo trataba como autónomo). Ver helper.
    is_autonomo: zBoolean().optional().default(false),
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
    // Dirección principal opcional al crear lead
    address_street_type: z.string().optional().default("calle"),
    address_street: z.string().optional().default(""),
    address_street_number: z.string().optional().default(""),
    address_portal: z.string().optional().default(""),
    address_floor: z.string().optional().default(""),
    address_door: z.string().optional().default(""),
    address_postal_code: z.string().optional().default(""),
    address_city: z.string().optional().default(""),
    address_province: z.string().optional().default(""),
    address_latitude: z.coerce.number().optional().nullable(),
    address_longitude: z.coerce.number().optional().nullable(),
  })
  .refine(
    (v) => {
      // Autónomo = persona física con actividad económica → su "nombre" es first_name.
      // Empresa pura → razón social.
      // Particular → first_name.
      if (v.party_kind === "company" && !v.is_autonomo) {
        return Boolean(v.legal_name?.trim());
      }
      return Boolean(v.first_name?.trim());
    },
    {
      message: "Nombre obligatorio (razón social para empresa, nombre para particular/autónomo)",
      path: ["legal_name"],
    },
  )
  // Tax ID: NO bloqueamos por formato (regla de negocio — admin
  // responsable). El usuario reportó CIFs reales rechazados (hay muchas
  // variantes y casos límite). El TaxIdInput sí muestra aviso visual si
  // el formato no es estándar, pero el envío al servidor sólo limpia.
  .refine((v) => !v.phone_primary?.trim() || validateSpanishPhone(v.phone_primary), {
    message: "Teléfono principal con formato inválido (móvil/fijo, 9 dígitos)",
    path: ["phone_primary"],
  })
  .refine((v) => !v.phone_company?.trim() || validateSpanishPhone(v.phone_company), {
    message: "Teléfono de empresa con formato inválido",
    path: ["phone_company"],
  })
  .refine(
    (v) =>
      !v.address_postal_code?.trim() ||
      validateSpanishPostalCode(v.address_postal_code),
    { message: "Código postal inválido", path: ["address_postal_code"] },
  );

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
