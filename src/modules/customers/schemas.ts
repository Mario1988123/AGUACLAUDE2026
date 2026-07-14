import { z } from "zod";
import { zBoolean } from "@/shared/lib/zod-friendly";
import { validatePhoneWithPrefix } from "@/shared/lib/phone/prefixes";

export const customerCreateSchema = z
  .object({
    party_kind: z.enum(["individual", "company"]),
    /** Solo aplica si party_kind=company. Toggle "Autónomo": tributa
     *  como persona física pero opera como empresa. A efectos de IVA/
     *  precio se comporta como empresa, pero el módulo de financieras
     *  lo distingue para filtrar qué financiera puede ofrecerse. */
    is_autonomo: zBoolean().optional().default(false),
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
      // Autónomo = persona física con actividad económica → no tiene
      // razón social. Su "nombre" es first_name.
      if (v.party_kind === "company" && !v.is_autonomo) {
        return Boolean(v.legal_name?.trim());
      }
      return Boolean(v.first_name?.trim());
    },
    { message: "Razón social o nombre obligatorio", path: ["legal_name"] },
  )
  // Tax ID: NO bloqueamos por formato. Hay múltiples variantes legales
  // (S.L., S.L.U., S.A., S.A.U., S. Coop., Comunidad de Bienes, OE, UTE,
  // entidades extranjeras…) y la validación estricta rechazaba muchas
  // empresas reales. El TaxIdInput avisa visualmente, pero el envío
  // sólo limpia. Admin es responsable.
  .refine((v) => !v.phone_primary?.trim() || validatePhoneWithPrefix(v.phone_primary), {
    message: "Teléfono principal con formato inválido (España: 9 dígitos; resto de Europa, con su prefijo)",
    path: ["phone_primary"],
  })
  .refine((v) => !v.phone_secondary?.trim() || validatePhoneWithPrefix(v.phone_secondary), {
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
    is_autonomo: zBoolean().optional(),
    notes: z.string().optional(),
  })
  // Tax ID: NO bloqueamos por formato — TaxIdInput avisa, admin responsable.
  .refine((v) => !v.phone_primary?.trim() || validatePhoneWithPrefix(v.phone_primary), {
    message: "Teléfono principal con formato inválido",
    path: ["phone_primary"],
  })
  .refine((v) => !v.phone_secondary?.trim() || validatePhoneWithPrefix(v.phone_secondary), {
    message: "Teléfono secundario con formato inválido",
    path: ["phone_secondary"],
  });

export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

/**
 * Schema para CONVERTIR un cliente particular en autónomo o empresa
 * (o un autónomo en empresa). Transición one-way con acción dedicada —
 * updateCustomerAction sigue sin aceptar party_kind a propósito.
 */
export const customerConvertSchema = z
  .object({
    mode: z.enum(["autonomo", "empresa"]),
    /** Solo mode=empresa: razón social nueva (obligatoria). */
    legal_name: z.string().optional().default(""),
    trade_name: z.string().optional().default(""),
    /** Solo mode=empresa: CIF nuevo (obligatorio). Aviso de formato en
     *  TaxIdInput pero NO se bloquea (política actual: admin responsable). */
    tax_id: z.string().optional().default(""),
    /** Solo mode=empresa: persona de contacto. Vacío = se conserva el
     *  titular actual como contacto (first_name/last_name de la fila). */
    contact_first_name: z.string().optional().default(""),
    contact_last_name: z.string().optional().default(""),
  })
  .refine((v) => v.mode !== "empresa" || Boolean(v.legal_name?.trim()), {
    message: "La razón social es obligatoria",
    path: ["legal_name"],
  })
  .refine((v) => v.mode !== "empresa" || Boolean(v.tax_id?.trim()), {
    message: "El CIF es obligatorio",
    path: ["tax_id"],
  });

export type CustomerConvertInput = z.infer<typeof customerConvertSchema>;
