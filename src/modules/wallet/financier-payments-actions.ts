"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface FinancierPaymentRow {
  contract_id: string;
  contract_reference: string | null;
  contract_signed_at: string | null;
  customer_name: string;
  financier_id: string | null;
  financier_name: string;
  financier_kind: "renting_strict" | "financing" | null;
  expected_payment_cents: number | null;
  expected_reserve_cents: number | null;
  payment_state: "pending" | "paid_customer" | "paid_financier" | "reserve_pending";
  financier_paid_at: string | null;
  financier_paid_amount_cents: number | null;
}

async function ensureAdminOrLevel2() {
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director");
  return { session, allowed };
}

/** Lista de contratos renting con financiera asignada y estado de pago
 *  abierto (pending / reserve_pending). Para el dashboard "Pagos
 *  financieras" del módulo Wallet. */
export async function listFinancierPaymentsPending(): Promise<FinancierPaymentRow[]> {
  const { session, allowed } = await ensureAdminOrLevel2();
  if (!allowed) return [];
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const FULL =
    "id, reference_code, signed_at, customer_id, customer_snapshot, financier_id, financier_payment_cents, financier_reserve_cents, payment_state, financier_paid_at, financier_paid_amount_cents";
  const res = await supabase
    .from("contracts")
    .select(FULL)
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .not("financier_id", "is", null)
    .in("payment_state", ["pending", "reserve_pending"])
    .order("signed_at", { ascending: false })
    .limit(200);
  if (
    res.error &&
    /financier_|payment_state|schema cache|Could not find/i.test(
      res.error.message ?? "",
    )
  ) {
    // Si los campos aún no están migrados, devolvemos lista vacía.
    console.warn("[listFinancierPaymentsPending]", res.error.message);
    return [];
  }
  if (res.error) throw res.error;
  const rows = (res.data ?? []) as Array<{
    id: string;
    reference_code: string | null;
    signed_at: string | null;
    customer_id: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer_snapshot: any;
    financier_id: string | null;
    financier_payment_cents: number | null;
    financier_reserve_cents: number | null;
    payment_state: FinancierPaymentRow["payment_state"];
    financier_paid_at: string | null;
    financier_paid_amount_cents: number | null;
  }>;
  if (rows.length === 0) return [];

  // Resolver nombres de financieras
  const finIds = Array.from(
    new Set(rows.map((r) => r.financier_id).filter((v): v is string => !!v)),
  );
  const finMap = new Map<string, { name: string; kind: string }>();
  if (finIds.length > 0) {
    const { data: fins } = await supabase
      .from("financiers")
      .select("id, name, kind")
      .in("id", finIds);
    for (const f of (fins ?? []) as Array<{
      id: string;
      name: string;
      kind: string;
    }>) {
      finMap.set(f.id, { name: f.name, kind: f.kind });
    }
  }

  return rows.map((r) => {
    const cust = r.customer_snapshot as
      | {
          legal_name?: string | null;
          trade_name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
        }
      | null;
    const name =
      cust?.trade_name ||
      cust?.legal_name ||
      `${cust?.first_name ?? ""} ${cust?.last_name ?? ""}`.trim() ||
      "Cliente";
    const fin = r.financier_id ? finMap.get(r.financier_id) : null;
    return {
      contract_id: r.id,
      contract_reference: r.reference_code,
      contract_signed_at: r.signed_at,
      customer_name: name,
      financier_id: r.financier_id,
      financier_name: fin?.name ?? "Sin financiera",
      financier_kind:
        (fin?.kind as "renting_strict" | "financing" | null) ?? null,
      expected_payment_cents: r.financier_payment_cents,
      expected_reserve_cents: r.financier_reserve_cents,
      payment_state: r.payment_state,
      financier_paid_at: r.financier_paid_at,
      financier_paid_amount_cents: r.financier_paid_amount_cents,
    };
  });
}

/** Confirma manualmente el pago recibido de la financiera para un
 *  contrato. Marca payment_state como paid_financier (o reserve_pending
 *  si hay reserva retenida). Guarda fecha + importe real. */
export async function confirmFinancierPaymentAction(input: {
  contract_id: string;
  /** ISO date — cuándo entró el dinero. */
  paid_at: string;
  /** Importe real recibido (céntimos). Puede diferir del esperado. */
  paid_amount_cents: number;
  /** Si la financiera retiene reserva → marcar reserve_pending. */
  has_reserve_pending?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { allowed } = await ensureAdminOrLevel2();
    if (!allowed) return { ok: false, error: "Solo admin / director" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const state = input.has_reserve_pending
      ? "reserve_pending"
      : "paid_financier";
    const r = await admin
      .from("contracts")
      .update({
        payment_state: state,
        financier_paid_at: input.paid_at,
        financier_paid_amount_cents: input.paid_amount_cents,
      })
      .eq("id", input.contract_id);
    if (r.error) return { ok: false, error: r.error.message };

    await admin.from("events").insert({
      subject_type: "contract",
      subject_id: input.contract_id,
      kind: "contract.financier_paid",
      payload: {
        paid_at: input.paid_at,
        paid_amount_cents: input.paid_amount_cents,
        has_reserve_pending: input.has_reserve_pending ?? false,
      },
    });

    revalidatePath("/wallet/financieras");
    revalidatePath(`/contratos/${input.contract_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/** Cuando finalmente entra la reserva retenida, marcamos paid_financier
 *  y registramos el ingreso adicional. */
export async function confirmReserveReleaseAction(input: {
  contract_id: string;
  paid_at: string;
  paid_amount_cents: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { allowed } = await ensureAdminOrLevel2();
    if (!allowed) return { ok: false, error: "Solo admin / director" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("contracts")
      .select("financier_paid_amount_cents")
      .eq("id", input.contract_id)
      .maybeSingle();
    const previous =
      (data as { financier_paid_amount_cents: number | null } | null)
        ?.financier_paid_amount_cents ?? 0;
    const upd = await admin
      .from("contracts")
      .update({
        payment_state: "paid_financier",
        financier_paid_amount_cents: previous + input.paid_amount_cents,
      })
      .eq("id", input.contract_id);
    if (upd.error) return { ok: false, error: upd.error.message };
    await admin.from("events").insert({
      subject_type: "contract",
      subject_id: input.contract_id,
      kind: "contract.reserve_released",
      payload: {
        paid_at: input.paid_at,
        amount_cents: input.paid_amount_cents,
      },
    });
    revalidatePath("/wallet/financieras");
    revalidatePath(`/contratos/${input.contract_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
