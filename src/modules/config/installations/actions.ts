"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { z } from "zod";
import { parseOrFriendly, zIntDefault } from "@/shared/lib/zod-friendly";

async function ensureAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) throw new Error("Solo admin");
  return session;
}

// Validación en servidor (auditoría 2026-10-01): antes el formulario hacía
// Number("") = 0 y se guardaba una tolerancia de 0 al dejar el campo vacío, y
// el objeto entero se copiaba al update. Ahora: solo estas dos columnas, vacío
// = valor por defecto (los mismos que usa la página), y rango como el <input>.
const configSchema = z.object({
  installation_geo_tolerance_m: zIntDefault(300, 50, "La tolerancia GPS mínima es 50 m").refine(
    (v) => v <= 5000,
    "La tolerancia GPS máxima es 5000 m",
  ),
  installation_time_tolerance_min: zIntDefault(30, 5, "La tolerancia mínima es 5 minutos").refine(
    (v) => v <= 240,
    "La tolerancia máxima es 240 minutos",
  ),
});

export async function saveInstallationsConfigAction(raw: {
  installation_geo_tolerance_m?: number | string;
  installation_time_tolerance_min?: number | string;
}): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  const input = parseOrFriendly(configSchema, raw, "Configuración de instalaciones");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: existing } = await admin
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("company_settings")
      .update(input)
      .eq("company_id", session.company_id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin
      .from("company_settings")
      .insert({ company_id: session.company_id, ...input });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/configuracion/instalaciones");
}

export async function saveInstallationsConfigSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await saveInstallationsConfigAction(input as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
