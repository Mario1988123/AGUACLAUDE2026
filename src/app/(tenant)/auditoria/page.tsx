import Link from "next/link";
import { listGlobalEventsPage } from "@/modules/events/global-actions";
import { EVENT_LABEL, SUBJECT_TYPE_LABEL, subjectLink } from "@/modules/events/labels";
import { listTeamMembers } from "@/modules/agenda/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function parseInt0(v: string | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{
    subject_type?: string;
    kind?: string;
    actor?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director") &&
    !session.roles.includes("commercial_director") &&
    !session.roles.includes("telemarketing_director")
  ) {
    redirect("/dashboard" as never);
  }

  const sp = await searchParams;
  const page = parseInt0(sp.page);
  const offset = page * PAGE_SIZE;
  const fromIso = sp.from ? `${sp.from}T00:00:00.000Z` : undefined;
  const toIso = sp.to ? `${sp.to}T23:59:59.999Z` : undefined;

  const [{ rows: events, total }, team] = await Promise.all([
    listGlobalEventsPage({
      subject_type: sp.subject_type,
      kind: sp.kind,
      actor_user_id: sp.actor,
      from: fromIso,
      to: toIso,
      limit: PAGE_SIZE,
      offset,
    }),
    listTeamMembers().catch(() => []),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function buildHref(extra: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    if (sp.subject_type) params.set("subject_type", sp.subject_type);
    if (sp.kind) params.set("kind", sp.kind);
    if (sp.actor) params.set("actor", sp.actor);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    Object.entries(extra).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    const q = params.toString();
    return q ? `/auditoria?${q}` : "/auditoria";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Auditoría</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registro inmutable de eventos · {total} resultados
            {totalPages > 1 && ` · página ${page + 1}/${totalPages}`}
          </p>
        </div>
        <Link
          href={"/api/export/audit" as never}
          prefetch={false}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          ⬇ Exportar últimos 90 días (CSV)
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Tipo entidad</label>
              <select
                name="subject_type"
                defaultValue={sp.subject_type ?? ""}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Todas</option>
                {Object.entries(SUBJECT_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Tipo evento</label>
              <select
                name="kind"
                defaultValue={sp.kind ?? ""}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {Object.entries(EVENT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Actor</label>
              <select
                name="actor"
                defaultValue={sp.actor ?? ""}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Cualquiera</option>
                {team.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.full_name}
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
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Hasta</label>
              <input
                type="date"
                name="to"
                defaultValue={sp.to ?? ""}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
              <button
                type="submit"
                className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Aplicar
              </button>
              {(sp.subject_type || sp.kind || sp.actor || sp.from || sp.to) && (
                <Link
                  href="/auditoria"
                  className="text-sm text-muted-foreground hover:underline"
                >
                  Limpiar
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eventos</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin eventos con esos filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2">Fecha</th>
                    <th className="py-2">Entidad</th>
                    <th className="py-2">Evento</th>
                    <th className="py-2">Actor</th>
                    <th className="py-2 text-right">Ver</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const link = subjectLink(e.subject_type, e.subject_id);
                    return (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(e.occurred_at).toLocaleString("es-ES")}
                        </td>
                        <td className="py-2">
                          <Badge variant="outline">
                            {SUBJECT_TYPE_LABEL[e.subject_type] ?? e.subject_type}
                          </Badge>
                        </td>
                        <td className="py-2 font-medium">
                          {EVENT_LABEL[e.kind] ?? e.kind}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {e.actor_name ?? "Sistema"}
                        </td>
                        <td className="py-2 text-right">
                          {link && (
                            <Link
                              href={link as never}
                              className="text-xs text-primary hover:underline"
                            >
                              Ver →
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
              <Link
                href={buildHref({ page: page > 0 ? String(page - 1) : undefined }) as never}
                className={`inline-flex h-9 items-center rounded-md border px-3 text-sm ${
                  page === 0
                    ? "pointer-events-none opacity-40"
                    : "hover:bg-muted"
                }`}
              >
                ← Anterior
              </Link>
              <span className="text-xs text-muted-foreground">
                Página {page + 1} de {totalPages}
              </span>
              <Link
                href={buildHref({ page: String(page + 1) }) as never}
                className={`inline-flex h-9 items-center rounded-md border px-3 text-sm ${
                  page + 1 >= totalPages
                    ? "pointer-events-none opacity-40"
                    : "hover:bg-muted"
                }`}
              >
                Siguiente →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
