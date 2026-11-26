"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import {
  KINDS_AVISOS_STOCK,
  listaDesdeExtra,
} from "@/modules/notifications/avisos-desactivados";

/**
 * Interruptores de avisos por empresa (Configuración → Notificaciones).
 * Guarda en company_settings.extra.avisos_desactivados la lista de kinds
 * apagados. Solo el admin de la empresa (o superadmin).
 */

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo el administrador de la empresa puede cambiar los avisos.");
  }
  if (!session.company_id) throw new Error("Sin empresa");
  return session;
}

async function guardarLista(companyId: string, cambiar: (actual: Set<string>) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: existing, error: errLeer } = await supabase
    .from("company_settings")
    .select("extra")
    .eq("company_id", companyId)
    .maybeSingle();
  if (errLeer) throw new Error(errLeer.message);
  const baseExtra = (existing?.extra as Record<string, unknown> | null) ?? {};
  const lista = new Set(listaDesdeExtra(baseExtra));
  cambiar(lista);
  const newExtra = { ...baseExtra, avisos_desactivados: [...lista].sort() };
  // .select() para enterarnos si RLS no dejó escribir (devolvería 0 filas sin error).
  const { data: escritas, error } = existing
    ? await supabase
        .from("company_settings")
        .update({ extra: newExtra })
        .eq("company_id", companyId)
        .select("company_id")
    : await supabase
        .from("company_settings")
        .insert({ company_id: companyId, extra: newExtra })
        .select("company_id");
  if (error) throw new Error(error.message);
  if (!escritas || escritas.length === 0) throw new Error("No se pudo guardar el ajuste.");
}

/** Enciende (activo=true) o apaga los avisos de stock de la empresa. */
export async function setAvisosStockSafeAction(
  activo: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    await guardarLista(session.company_id!, (lista) => {
      for (const k of KINDS_AVISOS_STOCK) {
        if (activo) lista.delete(k);
        else lista.add(k);
      }
    });
    revalidatePath("/configuracion/notificaciones");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
