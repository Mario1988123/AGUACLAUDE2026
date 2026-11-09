"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import {
  fianzaDecidible,
  fianzaExcedida,
  resumenFianza,
  validarMotivoRetencion,
  type PagoFianza,
} from "./fianza-logica";
import {
  deshacerDevolucionFianza,
  registrarDevolucionFianza,
  registrarRetencionFianza,
} from "./fianza-nucleo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Comprobaciones comunes de «Reintegrar fianza» y «Nos la quedamos»: sesión
 * de admin, contrato de TU empresa finalizado o cancelado y fianza pendiente.
 */
async function prepararDecisionFianza(contractId: string): Promise<
  | {
      ok: true;
      admin: Admin;
      companyId: string;
      userId: string;
      contrato: { id: string; customer_id: string | null };
      leer: () => Promise<ReturnType<typeof resumenFianza>>;
      pendiente: number;
      cobrada: number;
    }
  | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    return { ok: false, error: "Solo el administrador puede decidir la fianza" };
  }
  if (!UUID.test(contractId ?? "")) return { ok: false, error: "Contrato no válido" };
  const companyId = session.company_id;
  const admin = createAdminClient() as Admin;
  const { data: row, error: cErr } = await admin
    .from("contracts")
    .select("id, status, customer_id")
    .eq("id", contractId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (cErr) return { ok: false, error: cErr.message };
  const c = row as { id: string; status: string; customer_id: string | null } | null;
  if (!c) return { ok: false, error: "Contrato no encontrado" };
  if (!fianzaDecidible(c.status)) {
    return {
      ok: false,
      error: "Solo se decide la fianza de contratos finalizados o cancelados. Si sigue en vigor, usa «Finalizar alquiler».",
    };
  }
  const leer = async () => {
    const { data, error } = await admin
      .from("contract_payments")
      .select("concept, amount_cents, status")
      .eq("contract_id", c.id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return resumenFianza((data ?? []) as PagoFianza[]);
  };
  const r = await leer();
  if (r.pendiente <= 0) return { ok: false, error: "No hay fianza pendiente en este contrato" };
  return {
    ok: true,
    admin,
    companyId,
    userId: session.user_id,
    contrato: { id: c.id, customer_id: c.customer_id },
    leer,
    pendiente: r.pendiente,
    cobrada: r.cobrada,
  };
}

function revalidar(contractId: string) {
  revalidatePath(`/contratos/${contractId}`);
  revalidatePath("/contratos/alquileres");
  revalidatePath("/wallet");
}

/**
 * «Reintegrar fianza»: devuelve al cliente la fianza pendiente de un contrato
 * finalizado o cancelado. Reutiliza la devolución de
 * `finalizeRentalContractAction` (registrarDevolucionFianza). Solo admin.
 * Idempotente: solo lo pendiente (cobrada − devuelta − retenida); si dos
 * envíos coinciden, el segundo detecta el exceso y deshace el suyo.
 */
export async function reintegrarFianzaAction(input: {
  contract_id: string;
  nota?: string | null;
}): Promise<{ ok: true; devuelto_cents: number } | { ok: false; error: string }> {
  try {
    const prep = await prepararDecisionFianza(input?.contract_id);
    if (!prep.ok) return prep;
    const { admin, companyId, userId, contrato, leer, pendiente, cobrada } = prep;
    const nota = (input.nota ?? "").trim().slice(0, 1000) || null;

    const dev = await registrarDevolucionFianza(admin, {
      company_id: companyId,
      contract_id: contrato.id,
      customer_id: contrato.customer_id,
      cents: pendiente,
      actor_user_id: userId,
      notas: nota ? `Reintegro de fianza. ${nota}` : "Reintegro de fianza (contrato cerrado)",
    });
    if (fianzaExcedida(await leer())) {
      await deshacerDevolucionFianza(admin, dev);
      return { ok: false, error: "La fianza ya se ha decidido desde otra pantalla" };
    }

    const { error: evErr } = await admin.from("events").insert({
      company_id: companyId,
      subject_type: "contract",
      subject_id: contrato.id,
      kind: "contract.deposit_returned",
      payload: {
        return_cents: pendiente,
        deposit_total_cents: cobrada,
        nota,
        contract_payment_id: dev.contract_payment_id,
        wallet_entry_id: dev.wallet_entry_id,
      },
      actor_user_id: userId,
    });
    if (evErr) console.error("[reintegrarFianza] evento:", evErr.message);

    revalidar(contrato.id);
    return { ok: true, devuelto_cents: pendiente };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * «Nos la quedamos»: la empresa retiene la fianza pendiente de un contrato
 * finalizado o cancelado. Reutiliza la retención de
 * `finalizeRentalContractAction` (registrarRetencionFianza). Solo admin,
 * motivo obligatorio, solo lo pendiente e idempotente como el reintegro.
 */
export async function retenerFianzaAction(input: {
  contract_id: string;
  motivo: string;
}): Promise<{ ok: true; retenido_cents: number } | { ok: false; error: string }> {
  try {
    const m = validarMotivoRetencion(input?.motivo);
    if (!m.ok) return m;
    const prep = await prepararDecisionFianza(input.contract_id);
    if (!prep.ok) return prep;
    const { admin, companyId, userId, contrato, leer, pendiente, cobrada } = prep;

    const rt = await registrarRetencionFianza(admin, {
      company_id: companyId,
      contract_id: contrato.id,
      cents: pendiente,
      actor_user_id: userId,
      notas: m.motivo,
    });
    if (fianzaExcedida(await leer())) {
      await admin.from("contract_payments").delete().eq("id", rt.contract_payment_id);
      return { ok: false, error: "La fianza ya se ha decidido desde otra pantalla" };
    }

    const { error: evErr } = await admin.from("events").insert({
      company_id: companyId,
      subject_type: "contract",
      subject_id: contrato.id,
      kind: "contract.deposit_retained",
      payload: {
        retain_cents: pendiente,
        deposit_total_cents: cobrada,
        reason: m.motivo,
        contract_payment_id: rt.contract_payment_id,
      },
      actor_user_id: userId,
    });
    if (evErr) console.error("[retenerFianza] evento:", evErr.message);

    revalidar(contrato.id);
    return { ok: true, retenido_cents: pendiente };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
