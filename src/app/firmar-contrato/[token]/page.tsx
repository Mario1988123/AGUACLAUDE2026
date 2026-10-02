import { getContractByRemoteToken } from "@/modules/contracts/remote-sign-actions";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { RemoteSignClient } from "./remote-sign-client";

export const dynamic = "force-dynamic";

/**
 * Estados en los que un contrato todavía se puede firmar a distancia: los
 * mismos desde los que se permite ENVIAR a firmar (remote-sign-actions.ts:105).
 * [decide] Auditoría 2026-10-01 (I21): `pending_data` también lo usa la firma
 * con IBAN provisional, así que solo cuenta como firmable si el contrato aún
 * no tiene `signed_at`. Un contrato cancelado, completado o ya firmado en
 * persona no debe volver a firmarse desde un enlace viejo: hacerlo lo
 * devolvía a `signed` y relanzaba los efectos de la firma.
 *
 * OJO: esto solo protege la PÁGINA. La guarda de verdad tiene que estar en
 * submitRemoteSignatureAction (src/modules/contracts/remote-sign-actions.ts),
 * con un update condicional sobre estos mismos estados.
 */
const ESTADOS_FIRMABLES = new Set(["draft", "pending_data", "pending_signature"]);

function EnlaceNoDisponible({ motivo }: { motivo: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-red-200 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-3xl">
          ⚠
        </div>
        <h1 className="text-xl font-extrabold text-red-900">Enlace no disponible</h1>
        <p className="mt-2 text-sm text-muted-foreground">{motivo}</p>
      </div>
    </div>
  );
}

export default async function FirmarContratoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const r = await getContractByRemoteToken(token);

  if (!r.ok) {
    return <EnlaceNoDisponible motivo={r.error} />;
  }

  // Estado actual del contrato (el token ya está validado arriba: existe, no
  // caducado, no cancelado). Lectura mínima con admin: la página es pública.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: firma } = await admin
    .from("contract_remote_signatures")
    .select("contract_id")
    .eq("token", token)
    .maybeSingle();
  const contractId = (firma as { contract_id: string } | null)?.contract_id ?? null;
  const { data: c } = contractId
    ? await admin
        .from("contracts")
        .select("status, signed_at")
        .eq("id", contractId)
        .maybeSingle()
    : { data: null };
  const fila = c as { status: string; signed_at: string | null } | null;
  const estado = fila?.status ?? null;
  if (!estado || !ESTADOS_FIRMABLES.has(estado) || fila?.signed_at) {
    return (
      <EnlaceNoDisponible
        motivo={
          estado === "cancelled"
            ? "Este contrato se ha cancelado. Si crees que es un error, contacta con la empresa."
            : "Este contrato ya no está pendiente de firma. Si necesitas una copia, pídesela a la empresa."
        }
      />
    );
  }

  // El email del firmante NO se manda al navegador: el formulario pide que la
  // persona lo escriba y el servidor lo compara. Si viaja en las props, la
  // comprobación es decorativa (cualquiera lo lee en el payload de la página).
  // La vista no lo usa (ver remote-sign-client.tsx).
  const contract = { ...r.contract, signer_email: "" };

  return <RemoteSignClient token={token} contract={contract} />;
}
