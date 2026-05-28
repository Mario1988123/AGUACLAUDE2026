import Link from "next/link";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import {
  listEmailsPage,
  listWhatsAppPage,
  getEmailKpis,
  getStatsByTemplate,
  getStatsByUser,
} from "@/modules/mailing/dashboard-actions";
import { listTeamMembers } from "@/modules/agenda/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  bounced: "Rebotado",
  complained: "Spam",
  failed: "Fallido",
  read: "Leído",
};
const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  queued: "secondary",
  sending: "secondary",
  sent: "outline",
  delivered: "success",
  bounced: "destructive",
  complained: "destructive",
  failed: "destructive",
  read: "success",
};

function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MailingPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: "email" | "whatsapp";
    page?: string;
    template_key?: string;
    user_id?: string;
    kind?: string;
    status?: string;
    from?: string;
    to?: string;
    search?: string;
  }>;
}) {
  await assertModuleActive("mailing");
  const sp = await searchParams;
  const session = await requireSession();
  const tab = sp.tab === "whatsapp" ? "whatsapp" : "email";
  const isAdminOrLevel2 =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");

  const limit = 50;
  const page = Math.max(1, Number(sp.page ?? 1));
  const offset = (page - 1) * limit;
  const fromIso = sp.from ? new Date(`${sp.from}T00:00:00`).toISOString() : undefined;
  const toIso = sp.to ? new Date(`${sp.to}T23:59:59.999`).toISOString() : undefined;

  const [kpis, members] = await Promise.all([
    getEmailKpis(),
    listTeamMembers().catch(() => []),
  ]);

  // El tracking de aperturas/clics solo es real si la empresa envía por Resend
  // (vía webhook). Con SMTP propio no se mide → ocultamos esas métricas para no
  // mostrar 0% engañosos.
  let emailIsResend = false;
  if (session.company_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adminCli = (await import("@/shared/lib/supabase/admin")).createAdminClient() as any;
      const { data: comp } = await adminCli
        .from("companies")
        .select("email_provider")
        .eq("id", session.company_id)
        .maybeSingle();
      emailIsResend = comp?.email_provider === "resend";
    } catch {
      emailIsResend = false;
    }
  }

  let emailData: Awaited<ReturnType<typeof listEmailsPage>> = { rows: [], total: 0 };
  let whatsappData: Awaited<ReturnType<typeof listWhatsAppPage>> = { rows: [], total: 0 };
  let byTemplate: Awaited<ReturnType<typeof getStatsByTemplate>> = [];
  let byUser: Awaited<ReturnType<typeof getStatsByUser>> = [];

  if (tab === "email") {
    [emailData, byTemplate, byUser] = await Promise.all([
      listEmailsPage({
        template_key: sp.template_key,
        user_id: sp.user_id,
        kind: sp.kind as "transactional" | "marketing" | undefined,
        status: sp.status,
        from: fromIso,
        to: toIso,
        search: sp.search,
        limit,
        offset,
      }),
      getStatsByTemplate(),
      getStatsByUser(),
    ]);
  } else {
    whatsappData = await listWhatsAppPage({
      user_id: sp.user_id,
      status: sp.status,
      from: fromIso,
      to: toIso,
      search: sp.search,
      limit,
      offset,
    });
  }

  const totalPages = Math.max(
    1,
    Math.ceil((tab === "email" ? emailData.total : whatsappData.total) / limit),
  );

  function buildHref(extra: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (sp.template_key) params.set("template_key", sp.template_key);
    if (sp.user_id) params.set("user_id", sp.user_id);
    if (sp.kind) params.set("kind", sp.kind);
    if (sp.status) params.set("status", sp.status);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    if (sp.search) params.set("search", sp.search);
    Object.entries(extra).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    return `/mailing?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Mailing y WhatsApp</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdminOrLevel2
              ? "Todos los envíos automáticos y manuales del CRM."
              : "Solo los envíos hechos por ti."}
          </p>
        </div>
        <Link
          href="/mailing/campanas"
          className="inline-flex items-center gap-2 self-start rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          Campañas de email
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Hoy" value={String(kpis.sent_today)} />
        <KpiCard label="Última semana" value={String(kpis.sent_week)} />
        <KpiCard label="Último mes" value={String(kpis.sent_month)} />
        {emailIsResend && (
          <>
        <KpiCard label="% Apertura (mes)" value={`${kpis.open_rate_pct}%`} tone="success" />
        <KpiCard label="% Clics (mes)" value={`${kpis.click_rate_pct}%`} tone="success" />
        <KpiCard
          label="% Rebotes (mes)"
          value={`${kpis.bounce_rate_pct}%`}
          tone={kpis.bounce_rate_pct > 5 ? "error" : "muted"}
        />
          </>
        )}
        <KpiCard
          label="Cola pendiente"
          value={String(kpis.pending_outbox)}
          tone={kpis.pending_outbox > 0 ? "warning" : "muted"}
        />
        <KpiCard
          label="Violaciones RGPD (30d)"
          value={String(kpis.rgpd_violations_30d)}
          tone={kpis.rgpd_violations_30d > 0 ? "error" : "muted"}
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b">
        <Link
          href="/mailing?tab=email"
          className={`px-4 py-2 text-sm font-bold border-b-2 ${
            tab === "email"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          ✉ Email
        </Link>
        <Link
          href="/mailing?tab=whatsapp"
          className={`px-4 py-2 text-sm font-bold border-b-2 ${
            tab === "whatsapp"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          WhatsApp
        </Link>
      </div>

      {/* Filtros */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <input type="hidden" name="tab" value={tab} />
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Buscar</label>
          <input
            name="search"
            defaultValue={sp.search ?? ""}
            placeholder={tab === "email" ? "destinatario o asunto" : "teléfono o texto"}
            className="h-10 w-64 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        {tab === "email" && (
          <>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Plantilla</label>
              <input
                name="template_key"
                defaultValue={sp.template_key ?? ""}
                placeholder="ej. installation_reminder"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Tipo</label>
              <select
                name="kind"
                defaultValue={sp.kind ?? ""}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="transactional">Transaccional</option>
                <option value="marketing">Marketing</option>
              </select>
            </div>
          </>
        )}
        {isAdminOrLevel2 && (
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Comercial</label>
            <select
              name="user_id"
              defaultValue={sp.user_id ?? ""}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name || m.user_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Estado</label>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Desde</label>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Hasta</label>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Filtrar
        </button>
        <Link href={`/mailing?tab=${tab}`} className="text-sm text-muted-foreground hover:underline">
          Limpiar
        </Link>
      </form>

      {/* Tabla email */}
      {tab === "email" && (
        <Card>
          <CardHeader>
            <CardTitle>Emails ({emailData.total})</CardTitle>
          </CardHeader>
          <CardContent>
            {emailData.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin emails para los filtros seleccionados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2 text-left">Fecha</th>
                      <th className="py-2 text-left">Destinatario</th>
                      <th className="py-2 text-left">Asunto</th>
                      <th className="py-2 text-left">Plantilla</th>
                      <th className="py-2 text-center">Tipo</th>
                      <th className="py-2 text-center">Estado</th>
                      <th className="py-2 text-right">Opens/Clicks</th>
                      <th className="py-2 text-left">Comercial</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {emailData.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 text-xs text-muted-foreground tabular-nums">
                          {fmtDateTime(r.sent_at ?? r.created_at)}
                        </td>
                        <td className="py-2">
                          <div className="font-bold">{r.customer_name ?? r.to_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.to_email}</div>
                        </td>
                        <td className="py-2 max-w-xs truncate" title={r.subject}>
                          {r.subject}
                        </td>
                        <td className="py-2 text-xs font-mono">{r.template_key ?? "—"}</td>
                        <td className="py-2 text-center text-xs">
                          {r.kind === "marketing" ? (
                            <Badge variant="secondary">MK</Badge>
                          ) : (
                            <Badge variant="outline">TX</Badge>
                          )}
                        </td>
                        <td className="py-2 text-center">
                          <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-right tabular-nums text-xs">
                          {(r.opens_count ?? 0) > 0 || (r.clicks_count ?? 0) > 0
                            ? `${r.opens_count ?? 0} / ${r.clicks_count ?? 0}`
                            : "—"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {r.user_name ?? "Sistema"}
                        </td>
                        <td className="py-2 text-right">
                          <Link
                            href={`/mailing/${r.id}` as never}
                            className="text-xs font-bold text-primary hover:underline"
                          >
                            Ver →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabla whatsapp */}
      {tab === "whatsapp" && (
        <Card>
          <CardHeader>
            <CardTitle>WhatsApp ({whatsappData.total})</CardTitle>
          </CardHeader>
          <CardContent>
            {whatsappData.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin envíos de WhatsApp registrados (módulo Twilio aún no integrado o sin datos).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2 text-left">Fecha</th>
                      <th className="py-2 text-left">Destinatario</th>
                      <th className="py-2 text-left">Mensaje</th>
                      <th className="py-2 text-center">Estado</th>
                      <th className="py-2 text-left">Comercial</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {whatsappData.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 text-xs text-muted-foreground tabular-nums">
                          {fmtDateTime(r.sent_at ?? r.created_at)}
                        </td>
                        <td className="py-2">
                          <div className="font-bold">{r.customer_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.to_phone}</div>
                        </td>
                        <td className="py-2 max-w-md truncate" title={r.body}>
                          {r.body}
                        </td>
                        <td className="py-2 text-center">
                          <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {r.user_name ?? "Sistema"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Métricas por flujo y por comercial (solo email tab) */}
      {tab === "email" && byTemplate.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por flujo / plantilla (últimos 3 meses)</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Plantilla</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">% Apertura</th>
                  <th className="py-2 text-right">% Clics</th>
                  <th className="py-2 text-right">% Rebotes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {byTemplate.map((t) => (
                  <tr key={t.template_key}>
                    <td className="py-2 font-mono text-xs">{t.template_key}</td>
                    <td className="py-2 text-right tabular-nums">{t.total}</td>
                    <td className="py-2 text-right tabular-nums font-bold text-emerald-700">
                      {t.open_rate_pct}%
                    </td>
                    <td className="py-2 text-right tabular-nums">{t.click_rate_pct}%</td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        t.bounce_rate_pct > 5 ? "text-rose-700 font-bold" : ""
                      }`}
                    >
                      {t.bounce_rate_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === "email" && byUser.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por comercial (último mes)</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Comercial</th>
                  <th className="py-2 text-right">Enviados</th>
                  <th className="py-2 text-right">% Apertura</th>
                  <th className="py-2 text-right">% Clics</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {byUser.map((u) => (
                  <tr key={u.user_id}>
                    <td className="py-2 font-bold">{u.user_name}</td>
                    <td className="py-2 text-right tabular-nums">{u.total}</td>
                    <td className="py-2 text-right tabular-nums">{u.open_rate_pct}%</td>
                    <td className="py-2 text-right tabular-nums">{u.click_rate_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <Link
              href={buildHref({ page: String(page - 1) }) as never}
              className="inline-flex h-10 items-center rounded-xl border bg-card px-3 text-sm hover:bg-muted"
            >
              ← Anterior
            </Link>
          )}
          <span className="text-sm font-bold">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={buildHref({ page: String(page + 1) }) as never}
              className="inline-flex h-10 items-center rounded-xl border bg-card px-3 text-sm hover:bg-muted"
            >
              Siguiente →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "error" | "muted";
}) {
  const colorMap: Record<string, string> = {
    success: "text-emerald-700 bg-emerald-50",
    warning: "text-amber-700 bg-amber-50",
    error: "text-rose-700 bg-rose-50",
    muted: "text-foreground bg-card",
  };
  const cls = tone ? colorMap[tone] : "text-foreground bg-card";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
