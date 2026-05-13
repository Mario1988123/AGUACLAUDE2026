import { z } from "zod";
import {
  validateCIF,
  validateDNIorNIE,
  validateSpanishPhone,
} from "@/shared/lib/validations/spanish";

export const customerCreateSchema = z
  .object({
    party_kind: z.enum(["individual", "company"]),
    /** Solo aplica si party_kind=company. Toggle "Autónomo": tributa
     *  como persona física pero opera como empresa. A efectos de IVA/
     *  precio se comporta como empresa, pero el módulo de financieras
     *  lo distingue para filtrar qué financiera puede ofrecerse. */
    is_autonomo: z.coerce.boolean().optional().default(false),
    legal_name: z.string().optional().default(""),
    trade_name: z.string().optional().default(""),
    first_name: z.string().optional().default(""),
    last_name: z.string().optional().default(""),
    email: z.string().email("Email no válido").optional().or(z.literal("")),
    phone_primary: z.string().optional().default(""),
    phone_secondary: z.string().optional().default(""),
    tax_id: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    source_lead_id: z.string().uuid().optional(),
  })
  .refine(
    (v) => {
      if (v.party_kind === "company") return Boolean(v.legal_name?.trim());
      return Boolean(v.first_name?.trim());
    },
    { message: "Razón social o nombre obligatorio", path: ["legal_name"] },
  )
  // Tax ID válido según tipo de cliente (si está informado).
  .refine(
    (v) => {
      const t = v.tax_id?.trim();
      if (!t) return true;
      return v.party_kind === "company" ? validateCIF(t) : validateDNIorNIE(t).valid;
    },
    {
      message:
        "Documento (DNI/NIE/CIF) con formato inválido. Revisa que las letras y dígitos sean correctos.",
      path: ["tax_id"],
    },
  )
  // Teléfonos con formato español si están informados.
  .refine((v) => !v.phone_primary?.trim() || validateSpanishPhone(v.phone_primary), {
    message: "Teléfono principal con formato inválido (móvil/fijo español, 9 dígitos)",
    path: ["phone_primary"],
  })
  .refine((v) => !v.phone_secondary?.trim() || validateSpanishPhone(v.phone_secondary), {
    message: "Teléfono secundario con formato inválido",
    path: ["phone_secondary"],
  });

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

/** Schema para actualizar cliente — campos opcionales pero validados si vienen. */
export const customerUpdateSchema = z
  .object({
    legal_name: z.string().optional(),
    trade_name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().email("Email no válido").optional().or(z.literal("")),
    phone_primary: z.string().optional(),
    phone_secondary: z.string().optional(),
    tax_id: z.string().optional(),
    /** Necesario para validar tax_id según particular vs empresa. */
    party_kind: z.enum(["individual", "company"]).optional(),
    is_autonomo: z.coerce.boolean().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (v) => {
      const t = v.tax_id?.trim();
      if (!t) return true;
      // Sin party_kind, intentamos detectar: si empieza por letra "no DNI" tratamos como CIF
      const kind = v.party_kind;
      if (kind === "company") return validateCIF(t);
      if (kind === "individual") return validateDNIorNIE(t).valid;
      // Sin pista, aceptamos si cumple cualquiera
      return validateCIF(t) || validateDNIorNIE(t).valid;
    },
    {
      message: "Documento (DNI/NIE/CIF) con formato inválido",
      path: ["tax_id"],
    },
  )
  .refine((v) => !v.phone_primary?.trim() || validateSpanishPhone(v.phone_primary), {
    message: "Teléfono principal con formato inválido",
    path: ["phone_primary"],
  })
  .refine((v) => !v.phone_secondary?.trim() || validateSpanishPhone(v.phone_secondary), {
    message: "Teléfono secundario con formato inválido",
    path: ["phone_secondary"],
  });

export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
