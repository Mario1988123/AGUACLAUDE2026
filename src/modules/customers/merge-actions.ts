"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface DuplicateCustomerGroup {
  /** El campo por el que coinciden: tax_id | email | phone */
  field: "tax_id" | "email" | "phone";
  value: string;
  customers: Array<{
    id: string;
    display_name: string;
    party_kind: "individual" | "company";
    created_at: string;
  }>;
}

/**
 * Detecta clientes que tienen el mismo tax_id, email o teléfono. Devuelve
 * los grupos con 2+ coincidencias para que el admin decida fusionarlos.
 */
export async function findCustomerDuplicates(): Promise<DuplicateCustomerGroup[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("customers")
    .select(
      "id, party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary, created_at",
    )
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .limit(5000);
  type C = {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    tax_id: string | null;
    email: string | null;
    phone_primary: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as C[];
  function name(c: C): string {
    return c.party_kind === "company"
      ? c.trade_name || c.legal_name || "Sin nombre"
      : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre";
  }
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const groups = new Map<string, DuplicateCustomerGroup>();
  function add(field: DuplicateCustomerGroup["field"], value: string, c: C) {
    if (!value) return;
    const key = `${field}::${value}`;
    let g = groups.get(key);
    if (!g) {
      g = { field, value, customers: [] };
      groups.set(key, g);
    }
    g.customers.push({
      id: c.id,
      display_name: name(c),
      party_kind: c.party_kind,
      created_at: c.created_at,
    });
  }
  for (const c of rows) {
    add("tax_id", norm(c.tax_id), c);
    add("email", norm(c.email), c);
    add("phone", norm(c.phone_primary), c);
  }
  return Array.from(groups.values())
    .filter((g) => g.customers.length >= 2)
    .sort((a, b) => b.customers.length - a.customers.length);
}

/**
 * Fusiona dos clientes en uno. Mueve direcciones, contratos, instalaciones,
 * mantenimientos, propuestas, eventos y wallet del "secundario" al
 * "principal". Marca el secundario como deleted_at + notes.
 *
 * Es destructivo (soft-delete) — sólo admin/director.
 */
export async function mergeCustomersAction(
  primaryId: string,
  secondaryId: string,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!isUpper) throw new Error("Solo admin o director comercial");
  if (primaryId === secondaryId) throw new Error("No se pueden fusionar consigo mismo");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Ambos pertenecen a la empresa
  const { data: rows } = await supabase
    .from("customers")
    .select("id, company_id")
    .in("id", [primaryId, secondaryId]);
  const list = (rows ?? []) as Array<{ id: string; company_id: string }>;
  if (list.length !== 2) throw new Error("Cliente no encontrado");
  if (list.some((r) => r.company_id !== session.company_id))
    throw new Error("Cliente de otra empresa");

  // Mover relaciones (todas usan customer_id como FK).
  // Defensa cross-tenant (decisión 2026-05-20): SIEMPRE añadimos
  // .eq("company_id", session.company_id) — aunque la query de arriba
  // ya garantizó que ambos clientes son de la misma empresa, esto
  // previene que un row sin company_id correcto (corrupto) se mueva.
  const tables = [
    "addresses",
    "contracts",
    "installations",
    "maintenance_jobs",
    "proposals",
    "wallet_entries",
    "incidents",
    "free_trials",
    "customer_equipment",
  ];
  for (const t of tables) {
    try {
      await supabase
        .from(t)
        .update({ customer_id: primaryId })
        .eq("customer_id", secondaryId)
        .eq("company_id", session.company_id);
    } catch {
      /* algunas tablas pueden no tener customer_id o company_id; ignorar */
    }
  }

  // events NO tiene customer_id: la timeline se enlaza por subject_type/subject_id.
  // Antes iba en el bucle genérico y fallaba en silencio → la timeline del
  // cliente secundario se perdía al fusionar.
  try {
    await supabase
      .from("events")
      .update({ subject_id: primaryId })
      .eq("subject_type", "customer")
      .eq("subject_id", secondaryId)
      .eq("company_id", session.company_id);
  } catch {
    /* defensivo */
  }

  // Soft-delete el secundario (sigue con scope company_id por defensa)
  await supabase
    .from("customers")
    .update({
      deleted_at: new Date().toISOString(),
      notes: `Fusionado en ${primaryId} por ${session.user_id}`,
    })
    .eq("id", secondaryId)
    .eq("company_id", session.company_id);

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: primaryId,
    kind: "customer.merged",
    payload: { merged_from: secondaryId, merged_by: session.user_id },
    actor_user_id: session.user_id,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${primaryId}`);
}

export async function mergeCustomersSafeAction(
  primaryId: string,
  secondaryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mergeCustomersAction(primaryId, secondaryId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
