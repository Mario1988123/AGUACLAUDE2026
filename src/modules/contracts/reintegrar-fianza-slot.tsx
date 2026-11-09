import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { resumenFianza, type PagoFianza } from "./fianza-logica";
import { ReintegrarFianzaButton } from "./reintegrar-fianza-button";

/**
 * Hueco de servidor para la ficha del contrato: pinta «Reintegrar fianza»
 * solo si el usuario es admin, el contrato está finalizado y queda fianza
 * cobrada sin devolver ni retener. Se coloca con una sola línea en la página.
 */
export async function ReintegrarFianzaSlot({ contractId }: { contractId: string }) {
  const session = await requireSession();
  if (!session.company_id) return null;
  if (!session.is_superadmin && !session.roles.includes("company_admin")) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: c, error } = await admin
    .from("contracts")
    .select("id, status")
    .eq("id", contractId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (error || !c || (c as { status: string }).status !== "completed") return null;

  const { data: pagos, error: pErr } = await admin
    .from("contract_payments")
    .select("concept, amount_cents, status")
    .eq("contract_id", contractId)
    .eq("company_id", session.company_id);
  if (pErr) return null;
  const { pendiente } = resumenFianza((pagos ?? []) as PagoFianza[]);
  if (pendiente <= 0) return null;

  return <ReintegrarFianzaButton contractId={contractId} pendienteCents={pendiente} />;
}
