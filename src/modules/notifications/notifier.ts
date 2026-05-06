"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";

export type NotificationSeverity = "info" | "success" | "warning" | "error";
export type NotificationSubjectType =
  | "lead"
  | "customer"
  | "proposal"
  | "contract"
  | "installation"
  | "maintenance"
  | "incident"
  | "wallet_entry"
  | "product";

export interface NotifyInput {
  company_id: string;
  recipient_user_id: string;
  kind: string;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  subject_type?: NotificationSubjectType | null;
  subject_id?: string | null;
  action_url?: string | null;
  expires_at?: string | null;
}

export async function notify(input: NotifyInput): Promise<void> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("notifications").insert({
    company_id: input.company_id,
    recipient_user_id: input.recipient_user_id,
    kind: input.kind,
    severity: input.severity ?? "info",
    title: input.title,
    body: input.body ?? null,
    subject_type: input.subject_type ?? null,
    subject_id: input.subject_id ?? null,
    action_url: input.action_url ?? null,
    expires_at: input.expires_at ?? null,
  });
}

/**
 * Envía la misma notificación a todos los usuarios con cualquiera de los role_keys
 * activos en la empresa indicada. Sin destinatarios, no falla — solo no envía.
 */
export async function notifyByRoles(
  companyId: string,
  roleKeys: string[],
  payload: Omit<NotifyInput, "company_id" | "recipient_user_id">,
): Promise<void> {
  if (roleKeys.length === 0) return;
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roles } = await (admin as any)
    .from("user_roles")
    .select("user_id")
    .eq("company_id", companyId)
    .in("role_key", roleKeys)
    .is("revoked_at", null);

  const recipients = Array.from(
    new Set(((roles ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  );
  if (recipients.length === 0) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("notifications").insert(
    recipients.map((uid) => ({
      company_id: companyId,
      recipient_user_id: uid,
      kind: payload.kind,
      severity: payload.severity ?? "info",
      title: payload.title,
      body: payload.body ?? null,
      subject_type: payload.subject_type ?? null,
      subject_id: payload.subject_id ?? null,
      action_url: payload.action_url ?? null,
      expires_at: payload.expires_at ?? null,
    })),
  );
}

/**
 * Wrappers de conveniencia para los eventos más comunes — fail-soft (try/catch
 * dentro porque las notificaciones nunca deben tumbar el flujo principal).
 */
export async function notifyLeadCreated(
  companyId: string,
  leadId: string,
  leadName: string,
): Promise<void> {
  try {
    await notifyByRoles(companyId, ["company_admin", "telemarketing_director", "commercial_director"], {
      kind: "lead.created",
      severity: "info",
      title: "Nuevo lead",
      body: leadName,
      subject_type: "lead",
      subject_id: leadId,
      action_url: `/leads/${leadId}`,
    });
  } catch {
    /* no-op */
  }
}

export async function notifyContractSigned(
  companyId: string,
  contractId: string,
  ref: string | null,
): Promise<void> {
  try {
    await notifyByRoles(
      companyId,
      ["company_admin", "commercial_director", "technical_director"],
      {
        kind: "contract.signed",
        severity: "success",
        title: "Contrato firmado",
        body: ref ? `Ref ${ref}` : null,
        subject_type: "contract",
        subject_id: contractId,
        action_url: `/contratos/${contractId}`,
      },
    );
  } catch {
    /* no-op */
  }
}

export async function notifyInstallationCompleted(
  companyId: string,
  installationId: string,
  ref: string | null,
  /** ID del comercial que firmó el contrato (sales_rep). Recibe una
   *  notificación específica indicando que el cliente está instalado
   *  → cobra comisión + suma puntos. */
  salesRepUserId?: string | null,
): Promise<void> {
  // Notificación a admin/directores (gestión)
  try {
    await notifyByRoles(
      companyId,
      ["company_admin", "technical_director", "commercial_director"],
      {
        kind: "installation.completed",
        severity: "success",
        title: "Instalación completada",
        body: ref ? `Ref ${ref}` : null,
        subject_type: "installation",
        subject_id: installationId,
        action_url: `/instalaciones/${installationId}`,
      },
    );
  } catch {
    /* no-op */
  }

  // Notificación específica al comercial — el comercial NO ve la
  // página de instalaciones, pero sí debe enterarse de que su venta
  // se ha hecho efectiva para cobrar comisión.
  if (salesRepUserId) {
    try {
      await notify({
        company_id: companyId,
        recipient_user_id: salesRepUserId,
        kind: "installation.completed",
        severity: "success",
        title: "✓ Tu cliente ya está instalado",
        body: ref
          ? `Ref ${ref} — venta efectiva, comisión y puntos sumados`
          : "Venta efectiva, comisión y puntos sumados",
        subject_type: "installation",
        subject_id: installationId,
        action_url: `/contratos`,
      });
    } catch {
      /* no-op */
    }
  }
}

export async function notifyPaymentPendingValidation(
  companyId: string,
  entryId: string,
  amountCents: number,
  concept: string,
  method: string,
): Promise<void> {
  try {
    const eur = (amountCents / 100).toLocaleString("es-ES", {
      style: "currency",
      currency: "EUR",
    });
    await notifyByRoles(companyId, ["company_admin", "commercial_director"], {
      kind: "wallet.pending_validation",
      severity: "warning",
      title: "Pago pendiente de validar",
      body: `${eur} · ${concept} (${method})`,
      subject_type: "wallet_entry",
      subject_id: entryId,
      action_url: `/wallet`,
    });
  } catch {
    /* no-op */
  }
}

export async function notifyIncidentCreated(
  companyId: string,
  incidentId: string,
  title: string,
  severity: "low" | "medium" | "high" | "critical",
): Promise<void> {
  try {
    const sev: NotificationSeverity =
      severity === "critical" || severity === "high" ? "error" : "warning";
    await notifyByRoles(
      companyId,
      ["company_admin", "technical_director"],
      {
        kind: "incident.created",
        severity: sev,
        title: "Nueva incidencia",
        body: title,
        subject_type: "incident",
        subject_id: incidentId,
        action_url: `/incidencias`,
      },
    );
  } catch {
    /* no-op */
  }
}
