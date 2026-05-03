"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface UnitRow {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  is_global: boolean;
}

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

/**
 * Devuelve unidades visibles para la empresa: las globales (company_id null)
 * + las propias. Ordenadas por sort_order.
 */
export async function listUnits(): Promise<UnitRow[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const filter = session.company_id
    ? `company_id.is.null,company_id.eq.${session.company_id}`
    : `company_id.is.null`;
  const { data } = await admin
    .from("units_catalog")
    .select("id, company_id, code, label, sort_order")
    .eq("is_active", true)
    .or(filter)
    .order("sort_order");
  type R = {
    id: string;
    company_id: string | null;
    code: string;
    label: string;
    sort_order: number;
  };
  return ((data ?? []) as R[]).map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    sort_order: r.sort_order,
    is_global: r.company_id === null,
  }));
}

export async function addUnitAction(input: { code: string; label: string }): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("units_catalog").insert({
    company_id: session.company_id,
    code: input.code.trim(),
    label: input.label.trim(),
    sort_order: 1000,
  });
  revalidatePath("/configuracion/productos");
}

export async function deleteUnitAction(id: string): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Solo borra unidades de la empresa, NO las globales
  await admin
    .from("units_catalog")
    .update({ is_active: false })
    .eq("id", id)
    .eq("company_id", session.company_id);
  revalidatePath("/configuracion/productos");
}
