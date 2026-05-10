import Link from "next/link";
import { listGlobalEventsPage } from "@/modules/events/global-actions";
import { eventLabel, subjectLink, SUBJECT_TYPE_LABEL } from "@/modules/events/labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { listTeamMembers } from "@/modules/agenda/actions";

export const dynamic = "force-dynamic";

const SUBJECT_OPTIONS = [
  "lead",
  "customer",
  "proposal",
  "contract",
  "installation",
  "maintenance",
  "incident",
  "wallet_entry",
  "free_trial",
  "invoice",
  "product",
] as const;

export default async function EventosPage({
  searchParams,
}: {
  searchParams: Promise<{
    subject_type?: string;
    kind?: string;
    actor_user_id?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireSession();
  const sp = await searchParams;
  const limit = 50;
  const page = Math.max(1, Number(sp.page ?? 1));
  const offset = (page - 1) * limit;

  // Convert from/to (YYYY-MM-DD) to ISO timestamp boundaries
  const fromIso = sp.from ? new Date(`${sp.from}T00:00:00`).toISOString() : undefined;
  const toIso = sp.to ? new Date(`${sp.to}T23:59:59.999`).toISOString() : undefined;

  const [{ rows, total }, members] = await Promise.all([
    listGlobalEventsPage({
      subject_type: sp.subject_type,
      kind: sp.kind,
      actor_user_id: sp.actor_user_id,
      from: fromIso,
      to: toIso,
      limit,
      offset,
    }),
    listTeamMembers(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = !!(sp.subject_type || sp.kind || sp.actor_user_id || sp.from || sp.to);

  function buildHref(extra: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    if (sp.subject_type) params.set("subject_type", sp.subject_type);
    if (sp.kind) params.set("kind", sp.kind);
    if (sp.actor_user_id) params.set("actor_user_id", sp.actor_user_id);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    Object.entries(extra).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    const q = params.toString();
    return q ? `/eventos?${q}` : "/eventos";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Eventos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Timeline global de toda la actividad de la empresa. {total} eventos
          totales (página {page}/{totalPages}).
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Entidad</label>
          <select
            name="subject_type"
            defaultValue={sp.subject_type ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {SUBJECT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SUBJECT_TYPE_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Tipo evento</label>
          <input
            name="kind"
            defaultValue={sp.kind ?? ""}
            placeholder="ej. contract.signed"
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Usuario</label>
          <select
            name="actor_user_id"
            defaultValue={sp.actor_user_id ?? ""}
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
        {hasFilters && (
          <Link href="/eventos" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Actividad</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin eventos para los filtros seleccionados.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((ev) => {
                const link = subjectLink(ev.subject_type, ev.subject_id);
                return (
                  <li key={ev.id} className="py-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline">
                            {SUBJECT_TYPE_LABEL[ev.subject_type] ?? ev.subject_type}
                          </Badge>
                          <span className="text-sm font-bold">
                            {eventLabel(ev.kind)}
                          </span>
                          {link && (
                            <Link
                              href={link as never}
                              className="text-xs text-primary hover:underline"
                            >
                              Ver →
                            </Link>
                          )}
                        </div>
                        {ev.actor_name && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            por <strong>{ev.actor_name}</strong>
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {new Date(ev.occurred_at).toLocaleString("es-ES")}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

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
