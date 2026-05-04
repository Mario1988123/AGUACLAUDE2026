"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import type { MaintenancePlan } from "./actions";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo el admin de empresa puede gestionar planes");
  return session;
}

/**
 * Lista TODOS los planes (incluyendo inactivos) para la página de
 * configuración. La pública (`listMaintenancePlans`) solo devuelve activos.
 */
export async function listAllMaintenancePlansAction(): Promise<MaintenancePlan[]> {
  const session = await ensureAdmin();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("maintenance_plans")
    .select(
      "id, tier, name, monthly_cents, visits_per_year, parts_discount_percent, spare_equipment_included, description, is_active",
    )
    .eq("company_id", session.company_id)
    .order("monthly_cents");
  return (data ?? []) as MaintenancePlan[];
}

export async function updateMaintenancePlanAction(
  id: string,
  patch: Partial<{
    name: string;
    monthly_cents: number;
    visits_per_year: number | null;
    parts_discount_percent: number;
    spare_equipment_included: boolean;
    description: string | null;
    is_active: boolean;
  }>,
): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("maintenance_plans")
    .update(patch)
    .eq("id", id)
    .eq("company_id", session.company_id);
  if (r.error) throw new Error(r.error.message);
  revalidatePath("/configuracion/mantenimientos");
}

/**
 * Reseed forzado: si el admin borró/desactivó alguno y quiere volver a
 * los defaults Lite/Medium/Premium.
 */
export async function reseedDefaultPlansAction(): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const defaults = [
    {
      tier: "lite",
      name: "Lite",
      monthly_cents: 1000,
      visits_per_year: 1,
      parts_discount_percent: 0,
      spare_equipment_included: false,
      description:
        "Una visita al año para cambio de filtros. Cualquier visita extra o incidencia se cobra aparte.",
    },
    {
      tier: "medium",
      name: "Medium",
      monthly_cents: 1500,
      visits_per_year: 2,
      parts_discount_percent: 30,
      spare_equipment_included: false,
      description: "Dos visitas al año + 30 % de descuento en piezas.",
    },
    {
      tier: "premium",
      name: "Premium",
      monthly_cents: 2000,
      visits_per_year: null,
      parts_discount_percent: 50,
      spare_equipment_included: true,
      description:
        "Visitas ilimitadas + 50 % descuento en piezas + equipo de recambio incluido.",
    },
  ];
  for (const p of defaults) {
    await admin.from("maintenance_plans").upsert(
      { company_id: session.company_id, is_active: true, ...p },
      { onConflict: "company_id,tier" },
    );
  }
  revalidatePath("/configuracion/mantenimientos");
}
