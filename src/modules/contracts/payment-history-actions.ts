"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { resolveVisibleUserIds } from "@/shared/lib/auth/role-scope";

export interface PaymentHistoryEntry {
  id: string;
  concept: string;
  amount_cents: number;
  method: string;
  moment: string | null;
  status: string;
  /** Estado efectivo si el wallet vinculado adelantó. */
  effective_status: string;
  created_at: string;
  collected_at: string | null;
  validated_at: string | null;
  wallet_entry_id: string | null;
  wallet_status: string | null;
  notes: string | null;
  /** Categoría calculada: fee, deposit, install, other. */
  category: "fee" | "deposit" | "install" | "other";
}

export interface PaymentHistoryResult {
  ok: boolean;
  error?: string;
  contract_reference: string | null;
  customer_name: string | null;
  entries: PaymentHistoryEntry[];
  totals: {
    fees_collected_cents: number;
    fees_pending_cents: number;
    deposit_collected_cents: number;
    deposit_returned_cents: number;
    total_collected_cents: number;
  };
}

function categorize(concept: string): PaymentHistoryEntry["category"] {
  if (/Fianza|Devolución fianza|Retención fianza/i.test(concept)) return "deposit";
  if (/Instalación|Pago contado/i.test(concept)) return "install";
  if (/Cuota|Renta|1ª|primera/i.test(concept)) return "fee";
  return "other";
}

/**
 * Devuelve el histórico de pagos de un contrato con estado efectivo
 * (mirando wallet_entries vinculados). Para mostrar en modal desde la
 * cartera de alquileres y desde la ficha del contrato.
 */
export async function getContractPaymentHistory(
  contractId: string,
): Promise<PaymentHistoryResult> {
  const empty: PaymentHistoryResult = {
    ok: false,
    contract_reference: null,
    customer_name: null,
    entries: [],
    totals: {
      fees_collected_cents: 0,
      fees_pending_cents: 0,
      deposit_collected_cents: 0,
      deposit_returned_cents: 0,
      total_collected_cents: 0,
    },
  };
  try {
    const session = await requireSession();
    if (!session.company_id) return { ...empty, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Cargar contrato + scope check.
    const { data: contractRow } = await admin
      .from("contracts")
      .select("id, reference_code, customer_id, company_id, created_by, assigned_user_id")
      .eq("id", contractId)
      .maybeSingle();
    const contract = contractRow as
      | {
          id: string;
          reference_code: string | null;
          customer_id: string | null;
          company_id: string;
          created_by: string | null;
          assigned_user_id: string | null;
        }
      | null;
    if (!contract) return { ...empty, error: "Contrato no encontrado" };
    if (contract.company_id !== session.company_id)
      return { ...empty, error: "Otra empresa" };

    // Scope nivel 2/3.
    const visibleUserIds = await resolveVisibleUserIds(session);
    if (visibleUserIds !== null) {
      const inScope =
        (contract.created_by && visibleUserIds.includes(contract.created_by)) ||
        (contract.assigned_user_id && visibleUserIds.includes(contract.assigned_user_id));
      if (!inScope) return { ...empty, error: "Fuera de scope" };
    }

    // Cliente (nombre)
    let customerName: string | null = null;
    if (contract.customer_id) {
      const { data: cs } = await admin
        .from("customers")
        .select("party_kind, legal_name, trade_name, first_name, last_name")
        .eq("id", contract.customer_id)
        .maybeSingle();
      if (cs) {
        const cc = cs as {
          party_kind: "individual" | "company";
          legal_name: string | null;
          trade_name: string | null;
          first_name: string | null;
          last_name: string | null;
        };
        customerName =
          cc.party_kind === "company"
            ? cc.trade_name || cc.legal_name || "Sin nombre"
            : `${cc.first_name ?? ""} ${cc.last_name ?? ""}`.trim() || "Sin nombre";
      }
    }

    // Pagos
    const { data: payments } = await admin
      .from("contract_payments")
      .select(
        "id, concept, amount_cents, method, moment, status, created_at, collected_at, validated_at, wallet_entry_id, notes",
      )
      .eq("contract_id", contractId)
      .order("created_at", { ascending: true });
    type P = {
      id: string;
      concept: string;
      amount_cents: number;
      method: string;
      moment: string | null;
      status: string;
      created_at: string;
      collected_at: string | null;
      validated_at: string | null;
      wallet_entry_id: string | null;
      notes: string | null;
    };
    const rows = (payments ?? []) as P[];

    // Wallets vinculados (para resolver estado efectivo).
    const walletIds = rows
      .map((r) => r.wallet_entry_id)
      .filter((v): v is string => !!v);
    const walletStatus = new Map<string, string>();
    if (walletIds.length > 0) {
      const { data: ws } = await admin
        .from("wallet_entries")
        .select("id, status")
        .in("id", walletIds);
      for (const w of ((ws ?? []) as Array<{ id: string; status: string }>)) {
        walletStatus.set(w.id, w.status);
      }
    }

    function effective(p: P): string {
      if (p.status === "validated") return "validated";
      if (p.wallet_entry_id) {
        const ws = walletStatus.get(p.wallet_entry_id);
        if (ws === "validated" || ws === "settled") return "validated";
        if (ws === "collected") return "collected_pending_validation";
      }
      return p.status;
    }

    const entries: PaymentHistoryEntry[] = rows.map((p) => ({
      id: p.id,
      concept: p.concept,
      amount_cents: p.amount_cents,
      method: p.method,
      moment: p.moment,
      status: p.status,
      effective_status: effective(p),
      created_at: p.created_at,
      collected_at: p.collected_at,
      validated_at: p.validated_at,
      wallet_entry_id: p.wallet_entry_id,
      wallet_status: p.wallet_entry_id ? walletStatus.get(p.wallet_entry_id) ?? null : null,
      notes: p.notes,
      category: categorize(p.concept),
    }));

    // Totales
    const totals = entries.reduce(
      (acc, e) => {
        const isPaid =
          e.effective_status === "validated" ||
          e.effective_status === "collected_pending_validation";
        if (e.category === "fee") {
          if (isPaid) acc.fees_collected_cents += e.amount_cents;
          else acc.fees_pending_cents += e.amount_cents;
        } else if (e.category === "deposit") {
          if (e.amount_cents > 0 && isPaid) acc.deposit_collected_cents += e.amount_cents;
          if (e.amount_cents < 0 && isPaid) acc.deposit_returned_cents += -e.amount_cents;
        }
        if (isPaid) acc.total_collected_cents += e.amount_cents;
        return acc;
      },
      {
        fees_collected_cents: 0,
        fees_pending_cents: 0,
        deposit_collected_cents: 0,
        deposit_returned_cents: 0,
        total_collected_cents: 0,
      },
    );

    return {
      ok: true,
      contract_reference: contract.reference_code,
      customer_name: customerName,
      entries,
      totals,
    };
  } catch (e) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
