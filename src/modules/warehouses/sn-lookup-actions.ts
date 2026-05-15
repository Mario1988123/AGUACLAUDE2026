"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface SnLookupResult {
  equipment_id: string;
  serial_number: string;
  product_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  contract_id: string | null;
  contract_ref: string | null;
  installed_at: string | null;
  status: string | null;
}

/** Busca un equipo por su número de serie en la empresa actual.
 *  Devuelve cliente, contrato, fecha instalación y estado. */
export async function lookupSerialNumber(
  sn: string,
): Promise<SnLookupResult[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (!sn || sn.trim().length < 2) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("customer_equipment")
    .select(
      "id, serial_number, product_id, customer_id, contract_id, installed_at, status",
    )
    .eq("company_id", session.company_id)
    .ilike("serial_number", `%${sn.trim()}%`)
    .limit(20);
  type E = {
    id: string;
    serial_number: string;
    product_id: string | null;
    customer_id: string | null;
    contract_id: string | null;
    installed_at: string | null;
    status: string | null;
  };
  const equips = (data ?? []) as E[];
  if (equips.length === 0) return [];

  const productIds = Array.from(
    new Set(equips.map((e) => e.product_id).filter((v): v is string => !!v)),
  );
  const customerIds = Array.from(
    new Set(equips.map((e) => e.customer_id).filter((v): v is string => !!v)),
  );
  const contractIds = Array.from(
    new Set(equips.map((e) => e.contract_id).filter((v): v is string => !!v)),
  );

  const productMap = new Map<string, string>();
  const customerMap = new Map<string, string>();
  const contractMap = new Map<string, string>();

  if (productIds.length) {
    const { data: ps } = await admin
      .from("products")
      .select("id, name")
      .in("id", productIds);
    for (const p of (ps ?? []) as Array<{ id: string; name: string }>) {
      productMap.set(p.id, p.name);
    }
  }
  if (customerIds.length) {
    const { data: cs } = await admin
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", customerIds);
    for (const c of (cs ?? []) as Array<{
      id: string;
      party_kind: string;
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      const name =
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Cliente"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";
      customerMap.set(c.id, name);
    }
  }
  if (contractIds.length) {
    const { data: ks } = await admin
      .from("contracts")
      .select("id, reference_code")
      .in("id", contractIds);
    for (const k of (ks ?? []) as Array<{
      id: string;
      reference_code: string | null;
    }>) {
      contractMap.set(k.id, k.reference_code ?? k.id.slice(0, 8));
    }
  }

  return equips.map((e) => ({
    equipment_id: e.id,
    serial_number: e.serial_number,
    product_name: e.product_id ? productMap.get(e.product_id) ?? null : null,
    customer_id: e.customer_id,
    customer_name: e.customer_id
      ? customerMap.get(e.customer_id) ?? null
      : null,
    contract_id: e.contract_id,
    contract_ref: e.contract_id ? contractMap.get(e.contract_id) ?? null : null,
    installed_at: e.installed_at,
    status: e.status,
  }));
}
