"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { validateIBAN } from "@/shared/lib/validations/spanish";

export interface BankAccountRow {
  id: string;
  customer_id: string;
  account_holder_name: string | null;
  iban: string;
  bic: string | null;
  bank_name: string | null;
  is_primary: boolean;
  is_validated: boolean;
  created_at: string;
}

const bankCreateSchema = z.object({
  customer_id: z.string().uuid(),
  iban: z.string().refine((v) => validateIBAN(v.replace(/\s/g, "")), { message: "IBAN no válido" }),
  account_holder_name: z.string().optional().default(""),
  bic: z.string().optional().default(""),
  bank_name: z.string().optional().default(""),
  is_primary: z.boolean().default(true),
});

async function ensureAdminOrSuper() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin")
  ) {
    throw new Error("Solo el admin de empresa puede gestionar datos bancarios");
  }
  return session;
}

export async function listBankAccounts(customerId: string): Promise<BankAccountRow[]> {
  await ensureAdminOrSuper();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("customer_bank_accounts")
    .select(
      "id, customer_id, account_holder_name, iban, bic, bank_name, is_primary, is_validated, created_at",
    )
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BankAccountRow[];
}

export async function createBankAccountAction(input: unknown) {
  const session = await ensureAdminOrSuper();
  const parsed = bankCreateSchema.parse(input);
  const iban = parsed.iban.replace(/\s/g, "").toUpperCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  if (parsed.is_primary) {
    await supabase
      .from("customer_bank_accounts")
      .update({ is_primary: false })
      .eq("customer_id", parsed.customer_id)
      .is("deleted_at", null);
  }

  const { error } = await supabase.from("customer_bank_accounts").insert({
    company_id: session.company_id,
    customer_id: parsed.customer_id,
    account_holder_name: parsed.account_holder_name || null,
    iban,
    bic: parsed.bic || null,
    bank_name: parsed.bank_name || null,
    is_primary: parsed.is_primary,
    is_validated: true,
    created_by: session.user_id,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/clientes/${parsed.customer_id}`);
}

export async function deleteBankAccountAction(id: string, customerId: string) {
  await ensureAdminOrSuper();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { error } = await supabase
    .from("customer_bank_accounts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/clientes/${customerId}`);
}
