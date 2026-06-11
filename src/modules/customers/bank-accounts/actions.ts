"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { validateIBAN } from "@/shared/lib/validations/spanish";
import { isPendingIban } from "@/shared/lib/validations/iban-partial";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

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
  iban: z
    .string()
    .refine(
      (v) => {
        const clean = v.replace(/\s/g, "");
        return validateIBAN(clean) || isPendingIban(clean);
      },
      { message: "IBAN no válido" },
    ),
  account_holder_name: z.string().optional().default(""),
  bic: z.string().optional().default(""),
  bank_name: z.string().optional().default(""),
  is_primary: z.boolean().default(true),
});

/** Admin/superadmin: puede ver IBAN completo, crear, editar, borrar. */
function isLevel1(session: Awaited<ReturnType<typeof requireSession>>): boolean {
  return session.is_superadmin || session.roles.includes("company_admin");
}

/** Solo admin puede borrar cuentas bancarias para auditoría. */
async function ensureAdminOrSuper() {
  const session = await requireSession();
  if (!isLevel1(session)) {
    throw new Error("Solo el admin de empresa puede eliminar datos bancarios");
  }
  return session;
}

/** Cualquier rol puede listar/crear; el listado mascara el IBAN para
 *  niveles distintos al admin (privacidad: comercial solo ve últimos
 *  4 dígitos para que pueda confirmárselos al cliente si pregunta). */
async function ensureAnyRole() {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  return session;
}

/** Mascara IBAN dejando solo los últimos 4 caracteres visibles. */
function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, "");
  if (clean.length <= 4) return clean;
  return clean.slice(0, 4) + "*".repeat(clean.length - 8) + clean.slice(-4);
}

export async function listBankAccounts(customerId: string): Promise<BankAccountRow[]> {
  const session = await ensureAnyRole();
  // Admin client para sortear RLS — la verificación de pertenencia a la
  // empresa la hace el filtro company_id implícito vía customer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("customer_bank_accounts")
    .select(
      "id, customer_id, account_holder_name, iban, bic, bank_name, is_primary, is_validated, created_at, company_id",
    )
    .eq("customer_id", customerId)
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false });
  if (error) throw error;
  type Row = BankAccountRow & { company_id: string };
  const rows = (data ?? []) as Row[];
  // Niveles distintos a admin solo ven últimos 4 dígitos.
  if (!isLevel1(session)) {
    return rows.map((r) => ({
      ...r,
      iban: maskIban(r.iban),
    }));
  }
  return rows;
}

export async function createBankAccountAction(input: unknown) {
  // Cualquier rol (incluido sales_rep) puede AÑADIR cuenta bancaria.
  // Antes solo admin → era imposible que un comercial firmara contrato
  // de un cliente nuevo si no estaba el admin presente.
  const session = await ensureAnyRole();
  const parsed = parseOrFriendly(bankCreateSchema, input, "Cuenta bancaria");
  const iban = parsed.iban.replace(/\s/g, "").toUpperCase();
  // Admin client: la policy customer_bank_accounts_insert puede
  // restringir a admin y en cualquier caso el comercial NO debe verlo
  // luego (lo mascaramos en listBankAccounts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Verificar que el cliente pertenece a la empresa del caller
  const { data: customer } = await admin
    .from("customers")
    .select("company_id")
    .eq("id", parsed.customer_id)
    .maybeSingle();
  const cust = customer as { company_id: string } | null;
  if (!cust) throw new Error("Cliente no encontrado");
  if (cust.company_id !== session.company_id) {
    throw new Error("Cliente de otra empresa");
  }

  if (parsed.is_primary) {
    await admin
      .from("customer_bank_accounts")
      .update({ is_primary: false })
      .eq("customer_id", parsed.customer_id)
      .eq("company_id", session.company_id)
      .is("deleted_at", null);
  }

  const isPending = isPendingIban(iban);
  // Constraint en BD: length(iban) between 15 and 34. Para el placeholder
  // pendiente guardamos ES00 + 20 ceros (24 chars, IBAN español canónico
  // todo a cero) y dejamos is_validated=false como marca real de pendiente.
  const PENDING_IBAN_FULL = "ES00" + "0".repeat(20);
  const { error } = await admin.from("customer_bank_accounts").insert({
    company_id: session.company_id,
    customer_id: parsed.customer_id,
    account_holder_name: parsed.account_holder_name || null,
    iban: isPending ? PENDING_IBAN_FULL : iban,
    bic: parsed.bic || null,
    bank_name: parsed.bank_name || null,
    is_primary: parsed.is_primary,
    is_validated: !isPending,
    created_by: session.user_id,
  });
  if (error) {
    console.error("[createBankAccount] insert failed:", error.message);
    throw new Error(`No se pudo guardar el IBAN: ${error.message}`);
  }

  revalidatePath(`/clientes/${parsed.customer_id}`);
}

export async function deleteBankAccountAction(id: string, customerId: string) {
  // Solo admin puede borrar — protección de datos bancarios.
  const session = await ensureAdminOrSuper();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin client salta RLS → filtrar por company_id para no
  // borrar cuentas bancarias (IBAN/mandatos SEPA) de otra empresa.
  const { data, error } = await admin
    .from("customer_bank_accounts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", session.company_id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Cuenta no encontrada o no pertenece a tu empresa");
  revalidatePath(`/clientes/${customerId}`);
}

export async function createBankAccountSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createBankAccountAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteBankAccountSafeAction(
  id: string,
  customerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteBankAccountAction(id, customerId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
