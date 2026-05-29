"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * Modo de facturación de una empresa.
 *
 * - "simple":    sin certificado FNMT instalado → facturación legacy
 *                (sin huella Verifactu, sin envío AEAT). Es el modo válido
 *                hasta que sea obligatorio Verifactu (empresas 2027, autónomos
 *                jul-2027). El admin factura como hasta ahora.
 *
 * - "verifactu": con certificado FNMT instalado → la empresa quiere/puede
 *                emitir Verifactu. Las facturas (cuando estén implementadas en
 *                V2) se emiten con huella encadenada + QR. El sub-modo
 *                (verifactu_test vs verifactu producción) se controla aparte
 *                en company_settings.verifactu_mode.
 *
 * **Mutex automático**: subir el certificado activa Verifactu; eliminarlo lo
 * desactiva (cert-actions.ts ya fuerza verifactu_mode='no_envio' al borrar).
 * No hay un toggle extra que pueda dejar el sistema en estado inconsistente.
 */
export type InvoicingMode = "simple" | "verifactu";

export interface InvoicingModeInfo {
  mode: InvoicingMode;
  cert_present: boolean;
  cert_expires_at: string | null;
  verifactu_mode: "no_envio" | "verifactu_test" | "verifactu";
}

/**
 * Devuelve el modo de facturación efectivo de la empresa según presencia
 * del certificado FNMT. Defensivo: ante error o BD desinfo, asume "simple"
 * (modo seguro: no envía nada a AEAT por accidente).
 */
export async function getCompanyInvoicingMode(
  companyId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient?: any,
): Promise<InvoicingModeInfo> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = (adminClient ?? createAdminClient()) as any;
  try {
    const { data } = await admin
      .from("company_settings")
      .select("verifactu_cert_alias, verifactu_cert_expires_at, verifactu_mode")
      .eq("company_id", companyId)
      .maybeSingle();
    const row = (data ?? null) as {
      verifactu_cert_alias: string | null;
      verifactu_cert_expires_at: string | null;
      verifactu_mode: "no_envio" | "verifactu_test" | "verifactu" | null;
    } | null;
    const certPresent = !!row?.verifactu_cert_alias;
    return {
      mode: certPresent ? "verifactu" : "simple",
      cert_present: certPresent,
      cert_expires_at: row?.verifactu_cert_expires_at ?? null,
      verifactu_mode: row?.verifactu_mode ?? "no_envio",
    };
  } catch {
    return {
      mode: "simple",
      cert_present: false,
      cert_expires_at: null,
      verifactu_mode: "no_envio",
    };
  }
}
