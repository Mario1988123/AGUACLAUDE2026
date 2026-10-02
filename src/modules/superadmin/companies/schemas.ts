import { z } from "zod";
import { zIntDefault } from "@/shared/lib/zod-friendly";

export const companyStatusEnum = z.enum(["trial", "active", "suspended", "cancelled"]);

export const companyCreateSchema = z.object({
  name: z.string().min(2, "Nombre obligatorio"),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
  status: companyStatusEnum.default("trial"),
  max_users: zIntDefault(5, 1, "Al menos 1 usuario"),
  max_storage_mb: zIntDefault(1024, 64, "Mínimo 64 MB"),
  monthly_cost_cents: zIntDefault(0, 0, "No puede ser negativo"),
  billing_email: z.string().email().optional().or(z.literal("")),
  primary_color: z.string().default("#2563eb"),
  fiscal_legal_name: z.string().optional().default(""),
  fiscal_tax_id: z.string().optional().default(""),
  fiscal_address: z.string().optional().default(""),
});

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

export const companyUpdateSchema = companyCreateSchema.partial();
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;
