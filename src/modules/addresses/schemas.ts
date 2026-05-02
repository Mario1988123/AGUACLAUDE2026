import { z } from "zod";

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

export const addressUpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    lead_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    kind: z.enum(ADDRESS_KIND).default("home"),
    label: z.string().optional().default(""),
    is_primary: z.coerce.boolean().default(false),
    contact_name: z.string().optional().default(""),
    contact_phone: z.string().optional().default(""),
    street_type: z.enum(STREET_TYPE).default("calle"),
    street: z.string().min(1, "Calle obligatoria"),
    street_number: z.string().optional().default(""),
    portal: z.string().optional().default(""),
    floor: z.string().optional().default(""),
    door: z.string().optional().default(""),
    postal_code: z
      .string()
      .regex(/^\d{5}$/, "CP español debe tener 5 dígitos")
      .optional()
      .or(z.literal("")),
    city: z.string().optional().default(""),
    province: z.string().optional().default(""),
    latitude: z.coerce.number().optional().nullable(),
    longitude: z.coerce.number().optional().nullable(),
    notes: z.string().optional().default(""),
  })
  .refine((v) => Boolean(v.lead_id) !== Boolean(v.customer_id), {
    message: "La dirección debe pertenecer a un lead O a un cliente, no ambos",
  });

export type AddressUpsertInput = z.infer<typeof addressUpsertSchema>;
