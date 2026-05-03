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
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("customer_consents")
    .select("id, kind, granted, source, granted_at")
    .eq("customer_id", customerId)
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
