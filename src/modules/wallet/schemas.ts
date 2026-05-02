import { z } from "zod";

export const PAYMENT_METHOD = ["cash", "card", "bizum", "transfer", "direct_debit", "financing"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

export const walletEntryCreateSchema = z.object({
  contract_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  installation_id: z.string().uuid().optional(),
  concept: z.string().min(2, "Concepto obligatorio"),
  amount_cents: z.coerce.number().int().min(1, "Importe debe ser positivo"),
  method: z.enum(PAYMENT_METHOD),
  notes: z.string().optional().default(""),
});
export type WalletEntryCreateInput = z.infer<typeof walletEntryCreateSchema>;

export const walletValidateSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["validate", "reject"]),
  reason: z.string().optional(),
});
