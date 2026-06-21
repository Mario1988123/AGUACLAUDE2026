"use server";

import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { ensureInstallationConfirmationToken } from "./public-confirmation-actions";
import { sendTransactionalEmail } from "@/modules/mailing/actions";

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

const ALLOWED_ROLES = [
  "company_admin",
  "technical_director",
  "commercial_director",
];

/**
 * Envía al cliente el email de confirmación de su instalación con el deep
 * link público `/i/[token]`. Lo dispara manualmente el equipo desde la ficha
 * de la instalación. Reutiliza sendTransactionalEmail (branding + SMTP de la
 * empresa + tracking + RGPD).
 */
export async function sendInstallationConfirmationAction(
  installationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: inst } = await admin
      .from("installations")
      .select(
        "id, company_id, customer_id, address_id, scheduled_at, installer_user_id, created_by",
      )
      .eq("id", installationId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!inst) return { ok: false, error: "Instalación no encontrada" };
    const j = inst as {
      id: string;
      company_id: string;
      customer_id: string | null;
      address_id: string | null;
      scheduled_at: string | null;
      installer_user_id: string | null;
      created_by: string | null;
    };

    const allowed =
      session.is_superadmin ||
      session.roles.some((r) => ALLOWED_ROLES.includes(r)) ||
      j.created_by === session.user_id ||
      j.installer_user_id === session.user_id;
    if (!allowed) {
      return { ok: false, error: "No tienes permiso para enviar esta confirmación." };
    }

    if (!j.scheduled_at) {
      return {
        ok: false,
        error: "La instalación aún no tiene fecha programada. Asígnale una fecha antes de enviar la confirmación.",
      };
    }
    if (!j.customer_id) {
      return { ok: false, error: "La instalación no tiene cliente asociado." };
    }

    const { data: cust } = await admin
      .from("customers")
      .select("email, first_name, last_name, trade_name, legal_name, party_kind")
      .eq("id", j.customer_id)
      .maybeSingle();
    const c = (cust ?? {}) as {
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      trade_name: string | null;
      legal_name: string | null;
      party_kind: string | null;
    };
    if (!c.email) {
      return { ok: false, error: "El cliente no tiene email. Añádelo para poder enviarle la confirmación." };
    }
    const customerName =
      c.party_kind === "company"
        ? c.trade_name ?? c.legal_name ?? "Cliente"
        : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";

    // Dirección de la instalación (o primaria del cliente).
    let addr: {
      street_type: string | null;
      street: string | null;
      street_number: string | null;
      city: string | null;
      postal_code: string | null;
    } | null = null;
    if (j.address_id) {
      const { data } = await admin
        .from("addresses")
        .select("street_type, street, street_number, city, postal_code")
        .eq("id", j.address_id)
        .maybeSingle();
      addr = data ?? null;
    }
    if (!addr) {
      const { data } = await admin
        .from("addresses")
        .select("street_type, street, street_number, city, postal_code")
        .eq("customer_id", j.customer_id)
        .eq("is_primary", true)
        .maybeSingle();
      addr = data ?? null;
    }
    const customerAddress = addr?.street
      ? `${addr.street_type ? addr.street_type + " " : ""}${addr.street}${addr.street_number ? " " + addr.street_number : ""}${addr.postal_code ? ", " + addr.postal_code : ""}${addr.city ? " " + addr.city : ""}`
      : "";

    const token = await ensureInstallationConfirmationToken(installationId);
    if (!token) {
      return { ok: false, error: "No se pudo generar el enlace de confirmación." };
    }
    const confirmUrl = `${appBaseUrl()}/i/${token}`;

    const scheduled = new Date(j.scheduled_at);
    const res = await sendTransactionalEmail({
      template_key: "installation_confirm_request",
      to_email: c.email,
      to_name: customerName,
      customer_id: j.customer_id,
      related_subject_type: "installation",
      related_subject_id: installationId,
      variables: {
        appointment_date: scheduled.toISOString(),
        appointment_time: scheduled.toLocaleTimeString("es-ES", {
          timeZone: "Europe/Madrid",
          hour: "2-digit",
          minute: "2-digit",
        }),
        customer_address: customerAddress,
        confirm_url: confirmUrl,
      },
    });
    if (!res.ok) {
      return { ok: false, error: res.error ?? "No se pudo enviar el email." };
    }

    // Idempotencia / tracking (defensivo si la migración no está aplicada).
    try {
      await admin
        .from("installations")
        .update({ customer_confirm_sent_at: new Date().toISOString() })
        .eq("id", installationId);
    } catch {
      /* fail-soft */
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
