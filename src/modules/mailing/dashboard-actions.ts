"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface EmailListFilters {
  template_key?: string;
  user_id?: string;
  customer_id?: string;
  kind?: "transactional" | "marketing";
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface EmailListRow {
  id: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  template_key: string | null;
  kind: string;
  status: string;
  user_id: string | null;
  user_name: string | null;
  customer_id: string | null;
  lead_id: string | null;
  customer_name: string | null;
  sent_at: string | null;
  opens_count: number | null;
  clicks_count: number | null;
  delivered_at: string | null;
  bounced_at: string | null;
  created_at: string;
}

export interface EmailListPage {
  rows: EmailListRow[];
  total: number;
}

/**
 * Permisos:
 *   B (decisión usuario 2026-05-11):
 *   - admin / nivel 2 (directores) → ven TODOS los emails de la empresa.
 *   - resto (sales_rep, telemarketer, installer) → solo los SUYOS (user_id).
 */
async function effectiveUserFilter(): Promise<{
  companyId: string;
  restrictToUserId: string | null;
}> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isAdminOrLevel2 =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  return {
    companyId: session.company_id,
    restrictToUserId: isAdminOrLevel2 ? null : session.user_id,
  };
}

export async function listEmailsPage(filters: EmailListFilters): Promise<EmailListPage> {
  const { companyId, restrictToUserId } = await effectiveUserFilter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  let query = admin
    .from("email_sends")
    .select(
      "id, to_email, to_name, subject, template_key, kind, status, user_id, customer_id, lead_id, sent_at, opens_count, clicks_count, delivered_at, bounced_at, created_at",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (restrictToUserId) query = query.eq("user_id", restrictToUserId);
  if (filters.user_id) query = query.eq("user_id", filters.user_id);
  if (filters.template_key) query = query.eq("template_key", filters.template_key);
  if (filters.customer_id) query = query.eq("customer_id", filters.customer_id);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    query = query.or(`to_email.ilike.%${s}%,subject.ilike.%${s}%`);
  }

  const { data, count } = await query.range(offset, offset + limit - 1);
  type Row = Omit<EmailListRow, "user_name" | "customer_name">;
  const rows = (data ?? []) as Row[];

  // Resolver nombres
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v)));
  const customerIds = Array.from(
    new Set(rows.map((r) => r.customer_id).filter((v): v is string => !!v)),
  );
  const userNames = new Map<string, string>();
  const custNames = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    for (const p of (profs ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      userNames.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }
  if (customerIds.length > 0) {
    const { data: cus } = await admin
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", customerIds);
    for (const c of (cus ?? []) as Array<{
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      const name =
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "—"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";
      custNames.set(c.id, name);
    }
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      user_name: r.user_id ? userNames.get(r.user_id) ?? null : null,
      customer_name: r.customer_id ? custNames.get(r.customer_id) ?? null : null,
    })),
    total: count ?? rows.length,
  };
}

export interface EmailKpis {
  total: number;
  sent_today: number;
  sent_week: number;
  sent_month: number;
  open_rate_pct: number;
  click_rate_pct: number;
  bounce_rate_pct: number;
  pending_outbox: number;
  rgpd_violations_30d: number;
}

export async function getEmailKpis(): Promise<EmailKpis> {
  const { companyId, restrictToUserId } = await effectiveUserFilter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function withScope(query: any) {
    let q = query.eq("company_id", companyId);
    if (restrictToUserId) q = q.eq("user_id", restrictToUserId);
    return q;
  }

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startWeek = new Date(now);
  startWeek.setDate(startWeek.getDate() - 7);
  const startMonth = new Date(now);
  startMonth.setMonth(startMonth.getMonth() - 1);

  // Total
  const { count: totalCount } = await withScope(
    admin.from("email_sends").select("id", { count: "exact", head: true }),
  );
  const { count: todayCount } = await withScope(
    admin
      .from("email_sends")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startToday.toISOString()),
  );
  const { count: weekCount } = await withScope(
    admin
      .from("email_sends")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startWeek.toISOString()),
  );
  const { count: monthCount } = await withScope(
    admin
      .from("email_sends")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startMonth.toISOString()),
  );
  // Para tasas: solo los del mes
  const { data: monthRows } = await withScope(
    admin
      .from("email_sends")
      .select("status, opened_at, clicked_at, bounced_at")
      .gte("created_at", startMonth.toISOString())
      .limit(5000),
  );
  type R = {
    status: string;
    opened_at: string | null;
    clicked_at: string | null;
    bounced_at: string | null;
  };
  const list = (monthRows ?? []) as R[];
  const valid = list.filter((r) => r.status === "sent" || r.status === "delivered" || r.status === "bounced" || r.status === "complained");
  const opened = valid.filter((r) => !!r.opened_at).length;
  const clicked = valid.filter((r) => !!r.clicked_at).length;
  const bounced = valid.filter((r) => !!r.bounced_at).length;
  const baseDenom = valid.length || 1;

  const { count: pendingCount } = await admin
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .lte("send_at", new Date().toISOString());

  // RGPD violations: emails marketing enviados a clientes con consent revocado
  // últimos 30d. Coste alto: limitamos a query agregada.
  let rgpdViolations = 0;
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data: marketing } = await withScope(
      admin
        .from("email_sends")
        .select("customer_id")
        .eq("kind", "marketing")
        .not("customer_id", "is", null)
        .gte("created_at", since.toISOString())
        .limit(2000),
    );
    type M = { customer_id: string | null };
    const ids = Array.from(
      new Set(((marketing ?? []) as M[]).map((m) => m.customer_id).filter((v): v is string => !!v)),
    );
    if (ids.length > 0) {
      const { data: consents } = await admin
        .from("customer_consents")
        .select("customer_id, granted, granted_at")
        .in("customer_id", ids)
        .eq("kind", "commercial")
        .order("granted_at", { ascending: false });
      type C = { customer_id: string; granted: boolean };
      const latest = new Map<string, boolean>();
      for (const c of (consents ?? []) as C[]) {
        if (!latest.has(c.customer_id)) latest.set(c.customer_id, c.granted);
      }
      rgpdViolations = ids.filter((id) => latest.get(id) === false).length;
    }
  } catch (e) {
    console.error("[getEmailKpis] rgpd check failed:", e);
  }

  return {
    total: totalCount ?? 0,
    sent_today: todayCount ?? 0,
    sent_week: weekCount ?? 0,
    sent_month: monthCount ?? 0,
    open_rate_pct: Math.round((opened / baseDenom) * 100),
    click_rate_pct: Math.round((clicked / baseDenom) * 100),
    bounce_rate_pct: Math.round((bounced / baseDenom) * 100),
    pending_outbox: pendingCount ?? 0,
    rgpd_violations_30d: rgpdViolations,
  };
}

export interface ByTemplateRow {
  template_key: string;
  total: number;
  open_rate_pct: number;
  click_rate_pct: number;
  bounce_rate_pct: number;
}

export async function getStatsByTemplate(): Promise<ByTemplateRow[]> {
  const { companyId, restrictToUserId } = await effectiveUserFilter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const since = new Date();
  since.setMonth(since.getMonth() - 3);
  let q = admin
    .from("email_sends")
    .select("template_key, status, opened_at, clicked_at, bounced_at")
    .eq("company_id", companyId)
    .gte("created_at", since.toISOString())
    .not("template_key", "is", null)
    .limit(5000);
  if (restrictToUserId) q = q.eq("user_id", restrictToUserId);
  const { data } = await q;
  type R = {
    template_key: string;
    status: string;
    opened_at: string | null;
    clicked_at: string | null;
    bounced_at: string | null;
  };
  const grouped = new Map<string, { total: number; opened: number; clicked: number; bounced: number }>();
  for (const r of (data ?? []) as R[]) {
    const acc = grouped.get(r.template_key) ?? { total: 0, opened: 0, clicked: 0, bounced: 0 };
    acc.total += 1;
    if (r.opened_at) acc.opened += 1;
    if (r.clicked_at) acc.clicked += 1;
    if (r.bounced_at) acc.bounced += 1;
    grouped.set(r.template_key, acc);
  }
  return Array.from(grouped.entries())
    .map(([k, v]) => ({
      template_key: k,
      total: v.total,
      open_rate_pct: Math.round((v.opened / v.total) * 100),
      click_rate_pct: Math.round((v.clicked / v.total) * 100),
      bounce_rate_pct: Math.round((v.bounced / v.total) * 100),
    }))
    .sort((a, b) => b.total - a.total);
}

export interface ByUserRow {
  user_id: string;
  user_name: string;
  total: number;
  open_rate_pct: number;
  click_rate_pct: number;
}

export async function getStatsByUser(): Promise<ByUserRow[]> {
  const { companyId, restrictToUserId } = await effectiveUserFilter();
  if (restrictToUserId) return []; // Comerciales no ven ranking de otros
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const since = new Date();
  since.setMonth(since.getMonth() - 1);
  const { data } = await admin
    .from("email_sends")
    .select("user_id, opened_at, clicked_at")
    .eq("company_id", companyId)
    .gte("created_at", since.toISOString())
    .not("user_id", "is", null)
    .limit(5000);
  type R = { user_id: string; opened_at: string | null; clicked_at: string | null };
  const grouped = new Map<string, { total: number; opened: number; clicked: number }>();
  for (const r of (data ?? []) as R[]) {
    const acc = grouped.get(r.user_id) ?? { total: 0, opened: 0, clicked: 0 };
    acc.total += 1;
    if (r.opened_at) acc.opened += 1;
    if (r.clicked_at) acc.clicked += 1;
    grouped.set(r.user_id, acc);
  }
  const userIds = Array.from(grouped.keys());
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    for (const p of (profs ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      names.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }
  return Array.from(grouped.entries())
    .map(([uid, v]) => ({
      user_id: uid,
      user_name: names.get(uid) ?? uid.slice(0, 8),
      total: v.total,
      open_rate_pct: Math.round((v.opened / v.total) * 100),
      click_rate_pct: Math.round((v.clicked / v.total) * 100),
    }))
    .sort((a, b) => b.total - a.total);
}

export interface EmailDetail {
  id: string;
  to_email: string;
  to_name: string | null;
  from_email: string;
  from_name: string | null;
  subject: string;
  body_html: string | null;
  template_key: string | null;
  kind: string;
  status: string;
  resend_id: string | null;
  user_id: string | null;
  user_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  lead_id: string | null;
  related_subject_type: string | null;
  related_subject_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  opens_count: number | null;
  clicks_count: number | null;
  attachments_meta: Array<{ name: string }> | null;
  created_at: string;
  error_message: string | null;
}

export async function getEmailDetail(id: string): Promise<EmailDetail | null> {
  const { companyId, restrictToUserId } = await effectiveUserFilter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("email_sends")
    .select(
      "id, to_email, to_name, from_email, from_name, subject, body_html, template_key, kind, status, resend_id, user_id, customer_id, lead_id, related_subject_type, related_subject_id, sent_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at, opens_count, clicks_count, attachments_meta, created_at, error_message",
    )
    .eq("id", id)
    .eq("company_id", companyId);
  if (restrictToUserId) q = q.eq("user_id", restrictToUserId);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  const row = data as Omit<EmailDetail, "user_name" | "customer_name">;

  let userName: string | null = null;
  let custName: string | null = null;
  if (row.user_id) {
    const { data: p } = await admin
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", row.user_id)
      .maybeSingle();
    userName = (p as { full_name: string | null } | null)?.full_name ?? null;
  }
  if (row.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", row.customer_id)
      .maybeSingle();
    if (c) {
      custName =
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "—"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";
    }
  }

  return { ...row, user_name: userName, customer_name: custName };
}

/**
 * Reenviar un email ya guardado. Reusa subject + body_html y persiste un
 * nuevo email_sends. NO valida consentimiento (el original ya pasó por el
 * guard al primer envío); si quieres bloquear, hazlo desde la UI.
 */
export async function resendEmailAction(
  id: string,
): Promise<{ ok: boolean; new_send_id?: string; error?: string }> {
  const { companyId, restrictToUserId } = await effectiveUserFilter();
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("email_sends")
    .select(
      "id, to_email, to_name, from_email, from_name, subject, body_html, template_id, template_key, kind, customer_id, lead_id, related_subject_type, related_subject_id",
    )
    .eq("id", id)
    .eq("company_id", companyId);
  if (restrictToUserId) q = q.eq("user_id", restrictToUserId);
  const { data: orig } = await q.maybeSingle();
  if (!orig) return { ok: false, error: "Email no encontrado" };

  const o = orig as {
    to_email: string;
    to_name: string | null;
    from_email: string;
    from_name: string | null;
    subject: string;
    body_html: string;
    template_id: string | null;
    template_key: string | null;
    kind: string;
    customer_id: string | null;
    lead_id: string | null;
    related_subject_type: string | null;
    related_subject_id: string | null;
  };

  const { sendEmailViaResend } = await import("./resend");
  const result = await sendEmailViaResend({
    from_email: o.from_email,
    from_name: o.from_name ?? undefined,
    to_email: o.to_email,
    to_name: o.to_name ?? undefined,
    subject: `${o.subject} (reenvío)`,
    body_html: o.body_html,
  });

  const { data: newSend } = await admin
    .from("email_sends")
    .insert({
      company_id: companyId,
      user_id: session.user_id,
      template_id: o.template_id,
      template_key: o.template_key,
      to_email: o.to_email,
      to_name: o.to_name,
      from_email: o.from_email,
      from_name: o.from_name,
      subject: `${o.subject} (reenvío)`,
      body_html: o.body_html,
      kind: o.kind,
      status: result.ok ? "sent" : "failed",
      resend_id: result.resend_id,
      error_code: result.error_code,
      error_message: result.error_message,
      sent_at: result.ok ? new Date().toISOString() : null,
      customer_id: o.customer_id,
      lead_id: o.lead_id,
      related_subject_type: o.related_subject_type,
      related_subject_id: o.related_subject_id,
      metadata: { resent_from: id },
    })
    .select("id")
    .single();
  const newId = (newSend as { id: string } | null)?.id;

  if (newId && result.ok) {
    try {
      await admin.from("events").insert({
        company_id: companyId,
        subject_type: o.related_subject_type ?? (o.customer_id ? "customer" : "lead"),
        subject_id: o.related_subject_id ?? o.customer_id ?? o.lead_id ?? companyId,
        kind: "email.sent",
        payload: {
          email_send_id: newId,
          template_key: o.template_key,
          template_kind: o.kind,
          to_email: o.to_email,
          subject: `${o.subject} (reenvío)`,
          resent_from: id,
        },
        actor_user_id: session.user_id,
      });
    } catch {
      /* fail-soft */
    }
  }
  revalidatePath(`/mailing/${id}`);
  revalidatePath("/mailing");
  return { ok: result.ok, new_send_id: newId, error: result.error_message ?? undefined };
}

// ============================================================================
// WhatsApp dashboard
// ============================================================================
export interface WhatsAppListRow {
  id: string;
  to_phone: string;
  body: string;
  status: string;
  user_id: string | null;
  user_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  related_subject_type: string | null;
  related_subject_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error_message: string | null;
  created_at: string;
}

export async function listWhatsAppPage(filters: {
  user_id?: string;
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: WhatsAppListRow[]; total: number }> {
  const { companyId, restrictToUserId } = await effectiveUserFilter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;
  // La tabla puede llamarse whatsapp_sends o no existir todavía; defensivo.
  let q = admin
    .from("whatsapp_sends")
    .select(
      "id, to_phone, body, status, user_id, customer_id, related_subject_type, related_subject_id, sent_at, delivered_at, read_at, error_message, created_at",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (restrictToUserId) q = q.eq("user_id", restrictToUserId);
  if (filters.user_id) q = q.eq("user_id", filters.user_id);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    q = q.or(`to_phone.ilike.%${s}%,body.ilike.%${s}%`);
  }
  try {
    const { data, count } = await q.range(offset, offset + limit - 1);
    type Row = Omit<WhatsAppListRow, "user_name" | "customer_name">;
    const rows = (data ?? []) as Row[];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v)));
    const customerIds = Array.from(
      new Set(rows.map((r) => r.customer_id).filter((v): v is string => !!v)),
    );
    const userNames = new Map<string, string>();
    const custNames = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profs } = await admin
        .from("user_profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      for (const p of (profs ?? []) as Array<{ user_id: string; full_name: string | null }>) {
        userNames.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
      }
    }
    if (customerIds.length > 0) {
      const { data: cus } = await admin
        .from("customers")
        .select("id, party_kind, legal_name, trade_name, first_name, last_name")
        .in("id", customerIds);
      for (const c of (cus ?? []) as Array<{
        id: string;
        party_kind: "individual" | "company";
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
      }>) {
        const name =
          c.party_kind === "company"
            ? c.trade_name || c.legal_name || "—"
            : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";
        custNames.set(c.id, name);
      }
    }
    return {
      rows: rows.map((r) => ({
        ...r,
        user_name: r.user_id ? userNames.get(r.user_id) ?? null : null,
        customer_name: r.customer_id ? custNames.get(r.customer_id) ?? null : null,
      })),
      total: count ?? rows.length,
    };
  } catch (e) {
    console.error("[listWhatsAppPage] failed (tabla no existe?):", e);
    return { rows: [], total: 0 };
  }
}
