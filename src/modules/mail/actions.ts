"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Histórico de emails (módulo MAIL).
 *
 * Lee de `email_sends`. La RLS de Postgres ya hace el scoping
 * (company_admin / directores → todo de la empresa; nivel 3 → solo lo
 * suyo o lo relacionado con sus leads/clientes asignados). Aquí
 * encima añadimos filtros opcionales.
 */

export interface MailHistoryFilters {
  search?: string; // libre, busca en subject / to_email / to_name
  status?: "sent" | "failed" | "queued" | "delivered" | "bounced" | "complained" | "sending";
  sendType?: "manual" | "automated" | "campaign";
  triggerEvent?: string;
  fromDate?: string; // ISO
  toDate?: string;
  userId?: string;
  customerId?: string;
  leadId?: string;
  limit?: number;
  offset?: number;
}

export interface MailRow {
  id: string;
  to_email: string;
  to_name: string | null;
  from_email: string;
  from_name: string | null;
  subject: string;
  status: string;
  send_type: string | null;
  trigger_event: string | null;
  from_account_type: string | null;
  kind: string;
  template_key: string | null;
  user_id: string | null;
  customer_id: string | null;
  lead_id: string | null;
  related_subject_type: string | null;
  related_subject_id: string | null;
  sent_at: string | null;
  created_at: string;
  error_message: string | null;
}

export interface MailHistoryPage {
  rows: MailRow[];
  total: number;
}

export async function listMailHistory(
  filters: MailHistoryFilters = {},
): Promise<MailHistoryPage> {
  const session = await requireSession();
  if (!session.company_id) return { rows: [], total: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Usamos admin client (bypass RLS) y aplicamos el scoping a mano para
  // poder usar count exact + paginado eficiente. Los crons y otros sitios
  // también pasan por aquí; los superadmin tienen su propio panel.
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  let q = admin
    .from("email_sends")
    .select(
      [
        "id",
        "to_email",
        "to_name",
        "from_email",
        "from_name",
        "subject",
        "status",
        "send_type",
        "trigger_event",
        "from_account_type",
        "kind",
        "template_key",
        "user_id",
        "customer_id",
        "lead_id",
        "related_subject_type",
        "related_subject_id",
        "sent_at",
        "created_at",
        "error_message",
      ].join(","),
      { count: "exact" },
    )
    .eq("company_id", session.company_id);

  // Scoping por rol — defensa en código (la policy RLS es la otra capa).
  const isAdminOrLevel2 =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

  if (!isAdminOrLevel2) {
    // nivel 3 → solo los suyos (enviados por él) o de sus leads/customers asignados
    // Sacamos primero la lista de leads/customers asignados a él
    const [{ data: myLeads }, { data: myCustomers }] = await Promise.all([
      admin.from("leads").select("id").eq("assigned_user_id", session.user_id),
      admin.from("customers").select("id").eq("assigned_user_id", session.user_id),
    ]);
    const leadIds = (myLeads ?? []).map((r: { id: string }) => r.id);
    const customerIds = (myCustomers ?? []).map((r: { id: string }) => r.id);
    // OR: user_id = me  OR  lead_id ∈ myLeads  OR  customer_id ∈ myCustomers
    const orClauses: string[] = [`user_id.eq.${session.user_id}`];
    if (leadIds.length > 0) orClauses.push(`lead_id.in.(${leadIds.join(",")})`);
    if (customerIds.length > 0)
      orClauses.push(`customer_id.in.(${customerIds.join(",")})`);
    q = q.or(orClauses.join(","));
  }

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.sendType) q = q.eq("send_type", filters.sendType);
  if (filters.triggerEvent) q = q.eq("trigger_event", filters.triggerEvent);
  if (filters.userId) q = q.eq("user_id", filters.userId);
  if (filters.customerId) q = q.eq("customer_id", filters.customerId);
  if (filters.leadId) q = q.eq("lead_id", filters.leadId);
  if (filters.fromDate) q = q.gte("created_at", filters.fromDate);
  if (filters.toDate) q = q.lte("created_at", filters.toDate);
  if (filters.search) {
    const s = filters.search.replace(/[,%]/g, " ");
    q = q.or(
      `subject.ilike.%${s}%,to_email.ilike.%${s}%,to_name.ilike.%${s}%`,
    );
  }

  q = q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await q;
  if (error) {
    console.error("[mail/listMailHistory] error", error);
    return { rows: [], total: 0 };
  }
  return { rows: (data ?? []) as MailRow[], total: count ?? 0 };
}

export async function getMailDetail(id: string): Promise<MailRow & { body_html: string | null }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("email_sends")
    .select("*")
    .eq("id", id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (error || !data) throw new Error("Email no encontrado");

  // Re-aplicar scoping de seguridad
  const isAdminOrLevel2 =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isAdminOrLevel2) {
    if (data.user_id !== session.user_id) {
      const okLead =
        data.lead_id &&
        (await admin
          .from("leads")
          .select("id")
          .eq("id", data.lead_id)
          .eq("assigned_user_id", session.user_id)
          .maybeSingle()).data;
      const okCustomer =
        data.customer_id &&
        (await admin
          .from("customers")
          .select("id")
          .eq("id", data.customer_id)
          .eq("assigned_user_id", session.user_id)
          .maybeSingle()).data;
      if (!okLead && !okCustomer) throw new Error("No autorizado");
    }
  }
  return data as MailRow & { body_html: string | null };
}

export async function exportMailCsvAction(
  filters: MailHistoryFilters = {},
): Promise<string> {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo admin puede exportar");
  }
  const { rows } = await listMailHistory({ ...filters, limit: 10000, offset: 0 });
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const header = [
    "Fecha",
    "Destinatario",
    "Nombre",
    "Asunto",
    "Tipo",
    "Evento",
    "Estado",
    "Error",
    "Enviado por",
    "Cuenta SMTP",
    "Tipo plantilla",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.created_at,
        r.to_email,
        r.to_name,
        r.subject,
        r.send_type,
        r.trigger_event,
        r.status,
        r.error_message,
        r.user_id ?? "sistema",
        r.from_account_type,
        r.kind,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}
