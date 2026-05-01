import { z } from "zod";

export const companyStatusEnum = z.enum(["trial", "active", "suspended", "cancelled"]);

export const companyCreateSchema = z.object({
  name: z.string().min(2, "Nombre obligatorio"),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
  status: companyStatusEnum.default("trial"),
  max_users: z.coerce.number().int().min(1).default(5),
  max_storage_mb: z.coerce.number().int().min(64).default(1024),
  monthly_cost_cents: z.coerce.number().int().min(0).default(0),
  billing_email: z.string().email().optional().or(z.literal("")),
  primary_color: z.string().default("#2563eb"),
  fiscal_legal_name: z.string().optional().default(""),
  fiscal_tax_id: z.string().optional().default(""),
  fiscal_address: z.string().optional().default(""),
});

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

export const companyUpdateSchema = companyCreateSchema.partial();
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;
