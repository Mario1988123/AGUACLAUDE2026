import { z } from "zod";
import { zBoolean } from "@/shared/lib/zod-friendly";

export const ADDRESS_KIND = [
  "fiscal",
  "home",
  "office",
  "site",
  "warehouse",
  "installation",
  "shipping",
  "billing",
  "other",
] as const;
export type AddressKind = (typeof ADDRESS_KIND)[number];

export const KIND_LABEL: Record<AddressKind, string> = {
  fiscal: "Domicilio fiscal",
  home: "Vivienda",
  office: "Oficina",
  site: "Sede",
  warehouse: "Almacén",
  installation: "Instalación",
  shipping: "Envío",
  billing: "Facturación",
  other: "Otra",
};

export const STREET_TYPE = [
  "calle",
  "avenida",
  "plaza",
  "camino",
  "carretera",
  "urbanizacion",
  "paseo",
  "ronda",
  "travesia",
  "glorieta",
  "poligono",
  "via",
  "otra",
] as const;
export type StreetType = (typeof STREET_TYPE)[number];

export const STREET_TYPE_LABEL: Record<StreetType, string> = {
  calle: "Calle",
  avenida: "Avenida",
  plaza: "Plaza",
  camino: "Camino",
  carretera: "Carretera",
  urbanizacion: "Urbanización",
  paseo: "Paseo",
  ronda: "Ronda",
  travesia: "Travesía",
  glorieta: "Glorieta",
  poligono: "Polígono",
  via: "Vía",
  otra: "Otra",
};

// Helper: convierte null|undefined|"" → "" para que Zod acepte campos
// que el front-end manda como null. Antes con .optional() (solo
// undefined) Zod rechazaba el null y la action explotaba con digest
// "Server Components render".
const optStr = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => v ?? "");

export const addressUpsertSchema = z
  .object({
    id: z.string().uuid().nullish(),
    lead_id: z.string().uuid().nullish(),
    customer_id: z.string().uuid().nullish(),
    kind: z.enum(ADDRESS_KIND).default("home"),
    label: optStr,
    is_primary: zBoolean().default(false),
    contact_name: optStr,
    contact_phone: optStr,
    street_type: z.enum(STREET_TYPE).default("calle"),
    street: z.string().min(1, "Calle obligatoria"),
    street_number: optStr,
    portal: optStr,
    floor: optStr,
    door: optStr,
    postal_code: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => v ?? "")
      .refine((v) => v === "" || /^\d{5}$/.test(v), "CP español debe tener 5 dígitos"),
    city: optStr,
    province: optStr,
    latitude: z.coerce.number().nullish(),
    longitude: z.coerce.number().nullish(),
    notes: optStr,
  })
  .refine((v) => Boolean(v.lead_id) !== Boolean(v.customer_id), {
    message: "La dirección debe pertenecer a un lead O a un cliente, no ambos",
  });

export type AddressUpsertInput = z.infer<typeof addressUpsertSchema>;
