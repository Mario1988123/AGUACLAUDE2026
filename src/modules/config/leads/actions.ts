"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { diasInactividad } from "@/modules/leads/inactividad-logica";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

/**
 * Configuración de leads (decisión de Mario 12-11): ya no hay caducidad que
 * quite el lead; solo los días sin actividad antes de AVISAR al comercial.
 * `editable` es false mientras la migración 20261113100000 no esté aplicada
 * (la columna lead_stale_days no existe): entonces rigen 40 días fijos.
 */
export interface LeadsConfig {
  stale_days: number;
  editable: boolean;
}

export async function getLeadsConfig(): Promise<LeadsConfig> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // select("*"): tolerante a que la columna aún no exista.
  const { data } = await supabase
    .from("company_settings")
    .select("*")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  const fila = (data ?? null) as Record<string, unknown> | null;
  let editable = !!fila && "lead_stale_days" in fila;
  if (!fila) {
    // Sin fila de ajustes: comprobar si la columna existe con un select vacío.
    const r = await supabase.from("company_settings").select("lead_stale_days").limit(1);
    editable = !r.error;
  }
  return { stale_days: diasInactividad(fila), editable };
}

export async function updateLeadsConfigAction(input: { stale_days?: number }) {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const dias = Math.max(1, Math.min(365, Math.round(Number(input.stale_days) || 40)));
  const payload = { lead_stale_days: dias };

  const { data: existing } = await supabase
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  const r = existing
    ? await supabase
        .from("company_settings")
        .update(payload)
        .eq("company_id", session.company_id!)
    : await supabase
        .from("company_settings")
        .insert({ company_id: session.company_id!, ...payload });
  if (r?.error) {
    if (/lead_stale_days|schema cache|Could not find/i.test(r.error.message ?? "")) {
      throw new Error(
        "Este ajuste aún no está activo (falta aplicar una actualización de la base de datos). De momento se avisa a los 40 días.",
      );
    }
    throw r.error;
  }
  revalidatePath("/configuracion/leads");
}

export async function updateLeadsConfigSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateLeadsConfigAction(input as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
