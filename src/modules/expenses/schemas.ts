import { z } from "zod";

export const expenseCreateSchema = z.object({
  category_id: z.string().uuid().nullish(),
  category_code: z.string().nullish(),
  merchant_name: z.string().min(1).max(200).nullish(),
  merchant_nif: z.string().max(50).nullish(),
  merchant_address: z.string().max(500).nullish(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha YYYY-MM-DD inválida").nullish(),
  document_type: z.enum(["ticket_simple", "invoice_simple_qualified", "invoice_full"]).default("ticket_simple"),
  document_number: z.string().max(100).nullish(),
  total_cents: z.number().int().min(0),
  base_cents: z.number().int().min(0).nullish(),
  vat_cents: z.number().int().min(0).nullish(),
  vat_breakdown: z
    .array(
      z.object({
        rate: z.number(),
        base: z.number().nullish(),
        amount: z.number(),
      }),
    )
    .nullish(),
  currency: z.string().length(3).default("EUR"),
  payment_method: z.enum(["corp_card", "personal", "cash"]).default("personal"),
  corp_card_last4: z.string().max(4).nullish(),
  customer_id: z.string().uuid().nullish(),
  contract_id: z.string().uuid().nullish(),
  installation_id: z.string().uuid().nullish(),
  notes: z.string().max(2000).nullish(),
  receipt_storage_path: z.string().max(500).nullish(),
  receipt_mime: z.string().max(100).nullish(),
  ocr_provider: z.string().max(50).nullish(),
  ocr_raw: z.unknown().nullish(),
  ocr_confidence: z.number().min(0).max(1).nullish(),
});

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

export const perDiemCreateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  with_overnight: z.boolean(),
  scope: z.enum(["national", "eu", "international"]).default("national"),
  destination: z.string().max(200).nullish(),
  customer_id: z.string().uuid().nullish(),
  trip_purpose: z.string().max(500).nullish(),
  notes: z.string().max(2000).nullish(),
});

export type PerDiemCreateInput = z.infer<typeof perDiemCreateSchema>;

export const mileageCreateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origin: z.string().max(200).nullish(),
  destination: z.string().max(200).nullish(),
  km: z.number().int().min(1).max(5000),
  customer_id: z.string().uuid().nullish(),
  contract_id: z.string().uuid().nullish(),
  installation_id: z.string().uuid().nullish(),
  vehicle_plate: z.string().max(20).nullish(),
  notes: z.string().max(2000).nullish(),
});

export type MileageCreateInput = z.infer<typeof mileageCreateSchema>;
