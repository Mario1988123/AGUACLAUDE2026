"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface ToConfirmRow {
  id: string;
  contract_id: string | null;
  contract_reference: string | null;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  scheduled_at: string | null;
  /** Último mantenimiento completado de este contrato (si lo hay) — sirve
   *  para sugerir al admin qué técnico habitual asignar. */
  last_technician_user_id: string | null;
  last_technician_name: string | null;
}

interface PartyLike {
  party_kind: string | null;
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

function partyName(p: PartyLike | null | undefined, fallback: string): string {
  if (!p) return fallback;
  const company = p.trade_name ?? p.legal_name;
  const person = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  if (p.party_kind === "company") return company ?? person ?? fallback;
  return person || company || fallback;
}

function canSeeQueue(roles: string[], isSuper: boolean): boolean {
  return (
    isSuper ||
    roles.includes("company_admin") ||
    roles.includes("technical_director") ||
    roles.includes("telemarketing_director")
  );
}

/**
 * Devuelve los mantenimientos en estado `preprogrammed` de la empresa,
 * ordenados por fecha estimada ascendente. Solo accesible a nivel 1
 * (admin) y nivel 2 técnico/TMK — son los responsables de llamar al
 * cliente y confirmar la visita.
 *
 * Filtros opcionales:
 *  - daysAhead: si se pasa, solo trae los que caen en [hoy, hoy+daysAhead].
 *    Si se omite, devuelve TODOS los preprogrammed del año en curso
 *    (decisión usuario 2026-05-23).
 *  - q: filtro de texto sobre el nombre del cliente.
 */
export async function listMaintenanceToConfirm(
  daysAhead?: number,
): Promise<ToConfirmRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (!canSeeQueue(session.roles, session.is_superadmin)) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Rango
  let fromIso: string;
  let toIso: string;
  if (daysAhead != null) {
    const now = new Date();
    fromIso = now.toISOString();
    const end = new Date(now.getTime() + daysAhead * 86400000);
    toIso = end.toISOString();
  } else {
    // Por defecto: año en curso completo (decisión usuario: ver todos
    // los del año).
    const now = new Date();
    fromIso = new Date(now.getFullYear(), 0, 1).toISOString();
    toIso = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999).toISOString();
  }

  const { data: jobs, error } = await admin
    .from("maintenance_jobs")
    .select(
      "id, contract_id, customer_id, scheduled_at, customers(party_kind, legal_name, trade_name, first_name, last_name, phone_primary), contracts(reference_code)",
    )
    .eq("company_id", session.company_id)
    .eq("status", "preprogrammed")
    .gte("scheduled_at", fromIso)
    .lte("scheduled_at", toIso)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;

  type Raw = {
    id: string;
    contract_id: string | null;
    customer_id: string;
    scheduled_at: string | null;
    customers: (PartyLike & { phone_primary: string | null }) | null;
    contracts: { reference_code: string | null } | null;
  };
  const rows = (jobs ?? []) as Raw[];
  if (rows.length === 0) return [];

  // Resolver "último técnico" de cada contrato (mantenimiento más reciente
  // completed). Para no hacer N queries: agrupamos por contract_id y
  // hacemos una única query con un IN.
  const contractIds = Array.from(
    new Set(rows.map((r) => r.contract_id).filter((id): id is string => Boolean(id))),
  );
  const lastTechByContract = new Map<string, string | null>();
  if (contractIds.length > 0) {
    const { data: lastJobs } = await admin
      .from("maintenance_jobs")
      .select("contract_id, technician_user_id, completed_at")
      .in("contract_id", contractIds)
      .eq("status", "completed")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false });
    type LJ = {
      contract_id: string | null;
      technician_user_id: string | null;
      completed_at: string | null;
    };
    for (const lj of (lastJobs ?? []) as LJ[]) {
      if (!lj.contract_id) continue;
      if (!lastTechByContract.has(lj.contract_id)) {
        lastTechByContract.set(lj.contract_id, lj.technician_user_id);
      }
    }
  }
  // Nombres de los técnicos
  const techIds = Array.from(
    new Set(
      Array.from(lastTechByContract.values()).filter(
        (id): id is string => id !== null,
      ),
    ),
  );
  const techNameMap = new Map<string, string>();
  if (techIds.length > 0) {
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", techIds);
    for (const p of (profs ?? []) as Array<{
      user_id: string;
      full_name: string | null;
    }>) {
      techNameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }

  return rows.map<ToConfirmRow>((r) => {
    const lastTech = r.contract_id
      ? lastTechByContract.get(r.contract_id) ?? null
      : null;
    return {
      id: r.id,
      contract_id: r.contract_id,
      contract_reference: r.contracts?.reference_code ?? null,
      customer_id: r.customer_id,
      customer_name: partyName(r.customers, r.customer_id.slice(0, 8)),
      customer_phone: r.customers?.phone_primary ?? null,
      scheduled_at: r.scheduled_at,
      last_technician_user_id: lastTech,
      last_technician_name: lastTech ? techNameMap.get(lastTech) ?? null : null,
    };
  });
}

/**
 * Devuelve cuántos preprogrammed caen en los próximos N días (default 30).
 * Pensado para el banner de `/agenda` que enlaza a `/mantenimientos/por-confirmar`.
 * Sin permisos → 0 (no expone número sensible).
 */
export async function countMaintenanceToConfirm(
  daysAhead = 30,
): Promise<number> {
  const session = await requireSession();
  if (!session.company_id) return 0;
  if (!canSeeQueue(session.roles, session.is_superadmin)) return 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 86400000);
  const { count } = await admin
    .from("maintenance_jobs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", session.company_id)
    .eq("status", "preprogrammed")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", end.toISOString());
  return count ?? 0;
}
