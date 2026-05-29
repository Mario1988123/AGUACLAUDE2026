"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

async function ensureAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) {
    throw new Error("Solo el admin");
  }
  return session;
}

export async function setVerifactuModeAction(
  mode: "no_envio" | "verifactu" | "verifactu_test",
): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Mutex automático: no se puede activar Verifactu (test o producción) sin
  // certificado FNMT instalado. El certificado ES la señal de "quiero
  // Verifactu". Sin cert ⇒ facturación simple (no_envio).
  if (mode !== "no_envio") {
    const { data: cs } = await admin
      .from("company_settings")
      .select("verifactu_cert_alias")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const hasCert = !!(cs as { verifactu_cert_alias: string | null } | null)
      ?.verifactu_cert_alias;
    if (!hasCert) {
      throw new Error(
        "Sube primero el certificado digital FNMT en /configuracion/facturacion. Sin certificado no se puede activar Verifactu.",
      );
    }
  }

  // Upsert para crear settings si no existían
  const { data: existing } = await admin
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("company_settings")
      .update({
        verifactu_mode: mode,
        verifactu_environment: mode === "verifactu" ? "production" : "test",
      })
      .eq("company_id", session.company_id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("company_settings").insert({
      company_id: session.company_id,
      verifactu_mode: mode,
      verifactu_environment: mode === "verifactu" ? "production" : "test",
    });
    if (error) throw new Error(error.message);
  }

  // Audit
  try {
    await admin.from("invoice_verifactu_events").insert({
      company_id: session.company_id,
      event_type: "config_change",
      severity: "info",
      payload: { field: "verifactu_mode", new_value: mode },
      user_id: session.user_id,
    });
  } catch {
    /* fail-soft */
  }

  revalidatePath("/configuracion/facturacion");
}

export async function setVerifactuModeSafeAction(
  mode: "no_envio" | "verifactu" | "verifactu_test",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setVerifactuModeAction(mode);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
