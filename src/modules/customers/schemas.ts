import { z } from "zod";
import { zBoolean } from "@/shared/lib/zod-friendly";
import { validateSpanishPhone } from "@/shared/lib/validations/spanish";

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
    is_autonomo: zBoolean().optional(),
    notes: z.string().optional(),
  })
  // Tax ID: NO bloqueamos por formato — TaxIdInput avisa, admin responsable.
  .refine((v) => !v.phone_primary?.trim() || validateSpanishPhone(v.phone_primary), {
    message: "Teléfono principal con formato inválido",
    path: ["phone_primary"],
  })
  .refine((v) => !v.phone_secondary?.trim() || validateSpanishPhone(v.phone_secondary), {
    message: "Teléfono secundario con formato inválido",
    path: ["phone_secondary"],
  });

export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
