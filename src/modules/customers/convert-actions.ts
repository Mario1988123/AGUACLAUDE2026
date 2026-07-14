"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { isLevel1 } from "@/shared/lib/auth/role-scope";
import { isPlaceholderTaxId } from "@/shared/lib/validations/spanish";
import { customerConvertSchema, type CustomerConvertInput } from "./schemas";

// ============================================================================
// Conversión particular → autónomo / empresa (y autónomo → empresa)
// ----------------------------------------------------------------------------
// Ver PLAN_CONVERSION_CLIENTE_EMPRESA.md. Decisiones owner 2026-07-14:
// solo admin, autónomo→empresa incluido, SEPA = aviso (no bloqueo),
// DNI del titular anterior se conserva en notes + evento del timeline.
//
// Efectos verificados (no requieren código aquí):
// - Facturas emitidas/Verifactu y contratos firmados: snapshots inmutables.
// - Cuotas recurrentes: leen el cliente vivo al emitir → salen a nombre nuevo.
// - Precios duales y financieras: eligen por party_kind/is_autonomo en vivo.
// ============================================================================

export interface ConversionImpacts {
  /** Contratos rental/renting firmados: las próximas cuotas irán a la nueva titularidad. */
  active_contracts: number;
  /** Mandatos SEPA activos: quedan a nombre del titular anterior (hace falta uno nuevo). */
  active_mandates: number;
  /** Propuestas abiertas: conservan los precios de particular ya calculados. */
  open_proposals: number;
}

/**
 * Pre-chequeo de solo lectura para pintar los avisos del diálogo de
 * conversión. Fail-soft: si alguna tabla no está disponible, cuenta 0.
 */
export async function checkConversionImpactsAction(
  customerId: string,
): Promise<{ ok: true; impacts: ConversionImpacts } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) throw new Error("Sin empresa");
    if (!isLevel1(session)) throw new Error("Solo un administrador puede convertir clientes");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const count = async (
      table: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apply: (qb: any) => any,
    ): Promise<number> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qb: any = admin
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("company_id", session.company_id)
          .eq("customer_id", customerId);
        const { count: n, error } = await apply(qb);
        if (error) return 0;
        return n ?? 0;
      } catch {
        return 0;
      }
    };

    const [contracts, mandates, proposals] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count("contracts", (qb: any) =>
        qb.eq("status", "signed").in("plan_type", ["rental", "renting"]).is("deleted_at", null),
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count("sepa_mandates", (qb: any) => qb.eq("status", "active")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count("proposals", (qb: any) =>
        qb.in("status", ["draft", "pending_approval", "active", "sent"]).is("deleted_at", null),
      ),
    ]);

    return {
      ok: true,
      impacts: {
        active_contracts: contracts,
        active_mandates: mandates,
        open_proposals: proposals,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Convierte un cliente particular en autónomo o empresa (o un autónomo en
 * empresa). One-way. Solo admin. Deja el titular anterior en notes + evento
 * `customer.converted` del timeline (payload before/after).
 */
export async function convertCustomerAction(
  customerId: string,
  input: CustomerConvertInput,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!isLevel1(session)) throw new Error("Solo un administrador puede convertir clientes");

  const parsed = customerConvertSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Datos inválidos");
  }
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin client salta RLS → filtrar company_id (multi-tenant).
  const { data: cur, error: curErr } = await admin
    .from("customers")
    .select(
      "id, party_kind, is_autonomo, legal_name, trade_name, first_name, last_name, tax_id, notes",
    )
    .eq("id", customerId)
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (curErr) throw new Error(curErr.message);
  if (!cur) throw new Error("Cliente no encontrado o no pertenece a tu empresa");

  const current = cur as {
    party_kind: "individual" | "company";
    is_autonomo?: boolean | null;
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    tax_id: string | null;
    notes: string | null;
  };

  // Guards de dirección de la transición.
  if (v.mode === "autonomo" && current.party_kind !== "individual") {
    throw new Error("Solo un cliente particular puede pasar a autónomo");
  }
  if (
    v.mode === "empresa" &&
    current.party_kind === "company" &&
    !current.is_autonomo
  ) {
    throw new Error("El cliente ya es una empresa");
  }

  const fullName = `${current.first_name ?? ""} ${current.last_name ?? ""}`.trim();
  const today = new Date().toISOString().slice(0, 10);

  let update: Record<string, unknown>;
  let noteLine: string;
  if (v.mode === "autonomo") {
    // Convención existente (create-form): el autónomo no tiene razón social;
    // se copia su nombre a legal_name para que los listados que muestran
    // `trade_name || legal_name` funcionen. Conserva su DNI/NIE.
    update = {
      party_kind: "company",
      is_autonomo: true,
      legal_name: fullName || current.legal_name,
      trade_name: v.trade_name.trim() || null,
    };
    noteLine = `Convertido de particular a autónomo el ${today} (mismo titular y DNI).`;
  } else {
    const newTaxId = v.tax_id.trim().toUpperCase();
    // Dedupe del CIF nuevo (mismo patrón que updateCustomerAction; el DNI
    // comodín de venta al contado puede repetirse).
    if (!isPlaceholderTaxId(newTaxId)) {
      const { data: collision } = await admin
        .from("customers")
        .select("id")
        .eq("company_id", session.company_id)
        .eq("tax_id", newTaxId)
        .neq("id", customerId)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      if (collision) throw new Error("Ya existe otro cliente con ese DNI/CIF");
    }
    // El titular actual pasa a persona de contacto (first/last de la fila,
    // convención vigente para empresas) salvo que el diálogo mande otro.
    update = {
      party_kind: "company",
      is_autonomo: false,
      legal_name: v.legal_name.trim(),
      trade_name: v.trade_name.trim() || null,
      tax_id: newTaxId,
      first_name: v.contact_first_name.trim() || current.first_name,
      last_name: v.contact_last_name.trim() || current.last_name,
    };
    noteLine = `Convertido a empresa el ${today} — titular anterior: ${fullName || "(sin nombre)"}${
      current.tax_id ? ` (${current.is_autonomo ? "autónomo, " : ""}DNI/NIE ${current.tax_id})` : ""
    }.`;
  }
  // El DNI/titular anterior queda guardado en notas (decisión owner) además
  // del evento del timeline.
  update.notes = current.notes ? `${current.notes}\n\n${noteLine}` : noteLine;

  const { data: updated, error: updErr } = await admin
    .from("customers")
    .update(update)
    .eq("id", customerId)
    .eq("company_id", session.company_id)
    .select("id");
  if (updErr) throw new Error(updErr.message);
  if (!updated?.length) throw new Error("Cliente no encontrado o no pertenece a tu empresa");

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: customerId,
    kind: "customer.converted",
    payload: {
      mode: v.mode,
      before: {
        party_kind: current.party_kind,
        is_autonomo: Boolean(current.is_autonomo),
        legal_name: current.legal_name,
        trade_name: current.trade_name,
        first_name: current.first_name,
        last_name: current.last_name,
        tax_id: current.tax_id,
      },
      after: {
        party_kind: "company",
        is_autonomo: v.mode === "autonomo",
        legal_name: update.legal_name,
        trade_name: update.trade_name,
        first_name: update.first_name ?? current.first_name,
        last_name: update.last_name ?? current.last_name,
        tax_id: update.tax_id ?? current.tax_id,
      },
    },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/clientes");
}

export async function convertCustomerSafeAction(
  customerId: string,
  input: CustomerConvertInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await convertCustomerAction(customerId, input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
