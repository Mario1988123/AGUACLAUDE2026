import { z } from "zod";
import { spanishPhoneSchema } from "@/shared/lib/validations/schemas";

export const ROLE_KEYS = [
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
  "installer",
  "sales_rep",
  "telemarketer",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const userInviteSchema = z.object({
  email: z.string().email("Email no válido"),
  full_name: z.string().min(2, "Nombre obligatorio"),
  phone: z.string().optional().refine((v) => !v || spanishPhoneSchema.safeParse(v).success, {
    message: "Teléfono español no válido",
  }),
  job_title: z.string().optional(),
  roles: z.array(z.enum(ROLE_KEYS)).min(1, "Asigna al menos un rol"),
});

export type UserInviteInput = z.infer<typeof userInviteSchema>;
