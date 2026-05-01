import { z } from "zod";

export const customerCreateSchema = z
  .object({
    party_kind: z.enum(["individual", "company"]),
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
  );

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
