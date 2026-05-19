"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

function generateToken(): string {
  // UUID + 32 random hex = 68 chars, alta entropía.
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomBytes(16).toString("hex")}`;
}

export interface RemoteSignature {
  id: string;
  contract_id: string;
  token: string;
  signer_email: string;
  signer_name: string | null;
  sent_at: string;
  opened_at: string | null;
  signed_at: string | null;
  signature_data_url: string | null;
  expires_at: string;
  cancelled_at: string | null;
}

/**
 * Lista las firmas remotas (enviadas) de un contrato.
 */
export async function listRemoteSignaturesForContract(
  contractId: string,
): Promise<RemoteSignature[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("contract_remote_signatures")
      .select(
        "id, contract_id, token, signer_email, signer_name, sent_at, opened_at, signed_at, signature_data_url, expires_at, cancelled_at",
      )
      .eq("contract_id", contractId)
      .eq("company_id", session.company_id)
      .order("sent_at", { ascending: false });
    return (data ?? []) as RemoteSignature[];
  } catch {
    return [];
  }
}

const sendSchema = z.object({
  contract_id: z.string().uuid(),
  signer_email: z.string().trim().email(),
  signer_name: z.string().trim().min(1).max(120).nullish(),
});

/**
 * Genera un token único + crea fila contract_remote_signatures + envía
 * email al cliente con el link público para firmar. Idempotente solo en
 * el sentido de que si ya hay firma activa pendiente, devuelve el mismo
 * link.
 */
export async function sendContractForRemoteSignAction(
  input: unknown,
): Promise<
  | { ok: true; sign_url: string }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director") ||
      session.roles.includes("sales_rep");
    if (!allowed) return { ok: false, error: "Sin permisos" };
    const parsed = parseOrFriendly(sendSchema, input, "Firma remota");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Validar contrato
    const { data: row } = await admin
      .from("contracts")
      .select(
        "id, status, company_id, customer_id, reference_code, has_provisional_data",
      )
      .eq("id", parsed.contract_id)
      .maybeSingle();
    if (!row) return { ok: false, error: "Contrato no encontrado" };
    const c = row as {
      id: string;
      status: string;
      company_id: string;
      customer_id: string | null;
      reference_code: string | null;
      has_provisional_data: boolean;
    };
    if (c.company_id !== session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (!["draft", "pending_data", "pending_signature"].includes(c.status)) {
      return {
        ok: false,
        error: `El contrato está en estado ${c.status}, no se puede enviar a firmar.`,
      };
    }

    // ¿Hay ya un envío activo (sin firmar y sin caducar)?
    const { data: active } = await admin
      .from("contract_remote_signatures")
      .select("token, expires_at")
      .eq("contract_id", parsed.contract_id)
      .is("signed_at", null)
      .is("cancelled_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let token: string;
    if (active) {
      token = (active as { token: string }).token;
    } else {
      token = generateToken();
      const { error } = await admin.from("contract_remote_signatures").insert({
        company_id: session.company_id,
        contract_id: parsed.contract_id,
        token,
        signer_email: parsed.signer_email.toLowerCase(),
        signer_name: parsed.signer_name ?? null,
        sent_by_user_id: session.user_id,
      });
      if (error) return { ok: false, error: error.message };
    }

    // URL absoluta — leemos NEXT_PUBLIC_APP_URL o vercel host.
    const base =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const signUrl = `${base}/firmar-contrato/${token}`;

    // Enviar email vía sendTransactionalEmail con plantilla
    // 'contract_send_remote_sign' (fallback system-templates).
    try {
      const { sendTransactionalEmail } = await import("@/modules/mailing/actions");
      await sendTransactionalEmail({
        template_key: "contract_send_remote_sign",
        to_email: parsed.signer_email,
        to_name: parsed.signer_name ?? undefined,
        customer_id: c.customer_id,
        variables: {
          customer_first_name: parsed.signer_name ?? "",
          contract_ref: c.reference_code ?? "",
          sign_url: signUrl,
          days_to_expire: "14",
        },
        related_subject_type: "contract",
        related_subject_id: c.id,
      });
    } catch (e) {
      console.error("[remote-sign] email failed:", e);
      // No fallar la action por email — admin puede copiar el URL manualmente.
    }

    // Registrar evento
    try {
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: "contract",
        subject_id: c.id,
        kind: "contract.remote_sign_sent",
        payload: { email: parsed.signer_email },
        actor_user_id: session.user_id,
      });
    } catch {
      /* */
    }

    revalidatePath(`/contratos/${c.id}`);
    return { ok: true, sign_url: signUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Devuelve los datos públicos del contrato por token (sin auth).
 * Solo expone lo necesario para que el cliente firme. NO expone datos
 * sensibles de otros contratos ni del CRM interno.
 */
export async function getContractByRemoteToken(
  token: string,
): Promise<
  | { ok: true; contract: PublicContractView }
  | { ok: false; error: string }
> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: signRow } = await admin
      .from("contract_remote_signatures")
      .select(
        "id, contract_id, signer_email, signer_name, opened_at, signed_at, expires_at, cancelled_at",
      )
      .eq("token", token)
      .maybeSingle();
    if (!signRow) return { ok: false, error: "Enlace no válido." };
    const s = signRow as {
      id: string;
      contract_id: string;
      signer_email: string;
      signer_name: string | null;
      opened_at: string | null;
      signed_at: string | null;
      expires_at: string;
      cancelled_at: string | null;
    };
    if (s.cancelled_at) return { ok: false, error: "El enlace fue cancelado." };
    if (s.signed_at) {
      return {
        ok: false,
        error:
          "Este contrato ya fue firmado. Si crees que es un error, contacta con la empresa.",
      };
    }
    if (new Date(s.expires_at) < new Date()) {
      return {
        ok: false,
        error:
          "El enlace ha caducado (14 días). Pide a la empresa que te envíe uno nuevo.",
      };
    }

    // Marcar opened_at (primera apertura)
    if (!s.opened_at) {
      await admin
        .from("contract_remote_signatures")
        .update({ opened_at: new Date().toISOString() })
        .eq("id", s.id);
    }

    // Datos del contrato
    const { data: c } = await admin
      .from("contracts")
      .select(
        "id, reference_code, plan_type, total_cash_cents, monthly_cents, duration_months, customer_id, company_id",
      )
      .eq("id", s.contract_id)
      .maybeSingle();
    if (!c) return { ok: false, error: "Contrato no encontrado." };
    const cc = c as {
      id: string;
      reference_code: string | null;
      plan_type: string;
      total_cash_cents: number | null;
      monthly_cents: number | null;
      duration_months: number | null;
      customer_id: string | null;
      company_id: string;
    };

    // Empresa
    const { data: cs } = await admin
      .from("company_settings")
      .select("fiscal_legal_name, fiscal_trade_name, fiscal_logo_url")
      .eq("company_id", cc.company_id)
      .maybeSingle();
    const cset = cs as {
      fiscal_legal_name: string | null;
      fiscal_trade_name: string | null;
      fiscal_logo_url: string | null;
    } | null;

    return {
      ok: true,
      contract: {
        signature_id: s.id,
        signer_email: s.signer_email,
        signer_name: s.signer_name,
        reference_code: cc.reference_code,
        plan_type: cc.plan_type,
        total_cash_cents: cc.total_cash_cents,
        monthly_cents: cc.monthly_cents,
        duration_months: cc.duration_months,
        company_name:
          cset?.fiscal_trade_name || cset?.fiscal_legal_name || "la empresa",
        company_logo_url: cset?.fiscal_logo_url ?? null,
        pdf_url: `/api/pdf/contract/${cc.id}?token=${token}`,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export interface PublicContractView {
  signature_id: string;
  signer_email: string;
  signer_name: string | null;
  reference_code: string | null;
  plan_type: string;
  total_cash_cents: number | null;
  monthly_cents: number | null;
  duration_months: number | null;
  company_name: string;
  company_logo_url: string | null;
  pdf_url: string;
}

const submitSchema = z.object({
  token: z.string().min(32),
  signer_email: z.string().trim().email(),
  signature_data_url: z.string().min(200),
});

/**
 * Firma remota: el cliente confirma. Validamos token, email, no caducado,
 * no usado. Guardamos firma + IP + user-agent y marcamos el contrato
 * como 'signed' (mismo flujo que firma presencial pero con etiqueta de
 * origen remoto).
 */
export async function submitRemoteSignatureAction(input: {
  token: string;
  signer_email: string;
  signature_data_url: string;
  client_ip?: string | null;
  client_ua?: string | null;
}): Promise<{ ok: true; contract_id: string } | { ok: false; error: string }> {
  try {
    const parsed = parseOrFriendly(submitSchema, input, "Firma remota");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: signRow } = await admin
      .from("contract_remote_signatures")
      .select(
        "id, contract_id, signer_email, company_id, signed_at, cancelled_at, expires_at",
      )
      .eq("token", parsed.token)
      .maybeSingle();
    if (!signRow) return { ok: false, error: "Enlace no válido." };
    const s = signRow as {
      id: string;
      contract_id: string;
      signer_email: string;
      company_id: string;
      signed_at: string | null;
      cancelled_at: string | null;
      expires_at: string;
    };
    if (s.cancelled_at) return { ok: false, error: "El enlace fue cancelado." };
    if (s.signed_at) return { ok: false, error: "Ya fue firmado." };
    if (new Date(s.expires_at) < new Date())
      return { ok: false, error: "El enlace ha caducado." };
    if (
      s.signer_email.toLowerCase() !== parsed.signer_email.toLowerCase()
    ) {
      return {
        ok: false,
        error:
          "El email introducido no coincide con el del enlace recibido.",
      };
    }

    // Guardar firma + IP + UA
    const r1 = await admin
      .from("contract_remote_signatures")
      .update({
        signed_at: new Date().toISOString(),
        signature_data_url: parsed.signature_data_url,
        signer_ip: input.client_ip ?? null,
        signer_user_agent: input.client_ua ?? null,
      })
      .eq("id", s.id);
    if (r1.error) return { ok: false, error: r1.error.message };

    // Insertar también una contract_signature normal (role=customer) para
    // que aparezca en el PDF del contrato como firma del cliente.
    try {
      // Necesitamos snapshot del nombre — lo cogemos del customer.
      const { data: cinfo } = await admin
        .from("contracts")
        .select("customer_id")
        .eq("id", s.contract_id)
        .maybeSingle();
      const customerId = (cinfo as { customer_id: string | null } | null)
        ?.customer_id;
      let signerName = s.signer_email;
      let signerTaxId: string | null = null;
      if (customerId) {
        const { data: cu } = await admin
          .from("customers")
          .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id")
          .eq("id", customerId)
          .maybeSingle();
        if (cu) {
          const c = cu as {
            party_kind: "individual" | "company";
            legal_name: string | null;
            trade_name: string | null;
            first_name: string | null;
            last_name: string | null;
            tax_id: string | null;
          };
          signerName =
            c.party_kind === "company"
              ? c.trade_name || c.legal_name || s.signer_email
              : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                s.signer_email;
          signerTaxId = c.tax_id;
        }
      }
      await admin.from("contract_signatures").insert({
        company_id: s.company_id,
        contract_id: s.contract_id,
        signer_role: "customer",
        signer_name: signerName,
        signer_tax_id: signerTaxId,
        signature_data_url: parsed.signature_data_url,
      });
    } catch (e) {
      console.error("[remote-sign] insert contract_signature failed:", e);
    }

    // Marcar contrato como signed (mismo flujo que markContractSigned
    // pero más quirúrgico — no llamamos al wizard completo aquí).
    try {
      await admin
        .from("contracts")
        .update({
          status: "signed",
          signed_at: new Date().toISOString(),
        })
        .eq("id", s.contract_id);
    } catch (e) {
      console.error("[remote-sign] mark signed failed:", e);
    }

    // Evento
    try {
      await admin.from("events").insert({
        company_id: s.company_id,
        subject_type: "contract",
        subject_id: s.contract_id,
        kind: "contract.signed_remote",
        payload: {
          email: parsed.signer_email,
          ip: input.client_ip ?? null,
        },
      });
    } catch {
      /* */
    }

    revalidatePath(`/contratos/${s.contract_id}`);
    return { ok: true, contract_id: s.contract_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
