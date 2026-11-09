import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { fianzaDecidible, resumenFianza, type PagoFianza } from "./fianza-logica";
import { ReintegrarFianzaButton } from "./reintegrar-fianza-button";
import { RetenerFianzaButton } from "./retener-fianza-button";
import { FinalizarRentingButton } from "./finalizar-renting-button";

/**
 * Hueco de servidor de la ficha del contrato para las acciones de cierre.
 * Ya está colocado en la página con una sola línea; aquí se decide qué sale:
 *  - Fianza pendiente en un contrato finalizado o cancelado (solo admin):
 *    «Reintegrar fianza» y «Nos la quedamos».
 *  - Renting en vigor (solo admin): «Finalizar renting».
 */
export async function ReintegrarFianzaSlot({ contractId }: { contractId: string }) {
  const session = await requireSession();
  if (!session.company_id) return null;
  const esAdmin = session.is_superadmin || session.roles.includes("company_admin");
  if (!esAdmin) return null;
  const puedeRenting = esAdmin;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: c, error } = await admin
    .from("contracts")
    .select("id, status, plan_type, deleted_at")
    .eq("id", contractId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (error || !c) return null;
  const k = c as { id: string; status: string; plan_type: string; deleted_at: string | null };

  const rentingVivo =
    puedeRenting &&
    !k.deleted_at &&
    k.plan_type === "renting" &&
    (k.status === "signed" || k.status === "active");

  let pendiente = 0;
  if (esAdmin && fianzaDecidible(k.status)) {
    const { data: pagos, error: pErr } = await admin
      .from("contract_payments")
      .select("concept, amount_cents, status")
      .eq("contract_id", contractId)
      .eq("company_id", session.company_id);
    if (!pErr) pendiente = resumenFianza((pagos ?? []) as PagoFianza[]).pendiente;
  }

  if (!rentingVivo && pendiente <= 0) return null;
  return (
    <>
      {rentingVivo && <FinalizarRentingButton contractId={contractId} />}
      {pendiente > 0 && (
        <>
          <ReintegrarFianzaButton contractId={contractId} pendienteCents={pendiente} />
          <RetenerFianzaButton contractId={contractId} pendienteCents={pendiente} />
        </>
      )}
    </>
  );
}
