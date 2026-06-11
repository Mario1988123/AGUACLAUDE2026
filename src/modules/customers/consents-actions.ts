"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export type ConsentKind = "commercial" | "data_processing" | "profiling";
export type ConsentSource = "contract_sign" | "customer_creation" | "manual";

export interface RecordConsentArgs {
  customer_id: string;
  kind: ConsentKind;
  granted: boolean;
  source: ConsentSource;
  source_ref_id?: string | null;
  evidence?: Record<string, unknown>;
}

export async function recordCustomerConsent(args: RecordConsentArgs): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin client salta RLS → verificar que el cliente es de tu
  // empresa antes de grabar un consentimiento RGPD (PII sensible).
  const { data: ownerCust } = await admin
    .from("customers")
    .select("id")
    .eq("id", args.customer_id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!ownerCust) throw new Error("Cliente no encontrado o no pertenece a tu empresa");
  await admin.from("customer_consents").insert({
    company_id: session.company_id,
    customer_id: args.customer_id,
    kind: args.kind,
    granted: args.granted,
    source: args.source,
    source_ref_id: args.source_ref_id ?? null,
    evidence: args.evidence ?? {},
    recorded_by: session.user_id,
  });
  revalidatePath(`/clientes/${args.customer_id}`);
}

export interface ConsentRow {
  id: string;
  kind: string;
  granted: boolean;
  source: string;
  granted_at: string;
}

/**
 * Devuelve el estado actual de cada tipo de consentimiento (la última fila).
 */
export async function getCustomerConsents(customerId: string): Promise<ConsentRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin client salta RLS → filtrar por company_id (PII RGPD).
  const { data } = await admin
    .from("customer_consents")
    .select("id, kind, granted, source, granted_at")
    .eq("customer_id", customerId)
    .eq("company_id", session.company_id)
    .order("granted_at", { ascending: false })
    .limit(200);
  type R = ConsentRow;
  const rows = (data ?? []) as R[];
  // Última por kind
  const seen = new Set<string>();
  const latest: R[] = [];
  for (const r of rows) {
    if (seen.has(r.kind)) continue;
    seen.add(r.kind);
    latest.push(r);
  }
  return latest;
}

/**
 * Comprueba si un cliente tiene activo un consentimiento concreto. Devuelve
 * `false` si nunca lo ha concedido o si lo ha revocado. Se usa como guard
 * antes de enviar comunicaciones comerciales para cumplir RGPD: si el
 * cliente revocó, NO se le manda — aunque el flujo lo pidiera.
 *
 * Importante: data_processing es obligatorio para que cualquier comunicación
 * transaccional sea posible. Si está revocado, la empresa NO debería ni
 * facturar (sería una decisión legal-administrativa, no un guard técnico).
 */
export async function hasActiveConsent(
  customerId: string,
  kind: ConsentKind,
): Promise<boolean> {
  const session = await requireSession();
  if (!session.company_id) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin client salta RLS → filtrar por company_id.
  const { data } = await admin
    .from("customer_consents")
    .select("granted")
    .eq("customer_id", customerId)
    .eq("company_id", session.company_id)
    .eq("kind", kind)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  return (data as { granted: boolean }).granted === true;
}

export async function recordCustomerConsentSafe(
  args: RecordConsentArgs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await recordCustomerConsent(args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
