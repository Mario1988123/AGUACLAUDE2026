import Link from "next/link";
import { listGlobalEvents } from "@/modules/events/global-actions";
import { EVENT_LABEL, SUBJECT_TYPE_LABEL, subjectLink } from "@/modules/events/labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ subject_type?: string; kind?: string }>;
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
  const events = await listGlobalEvents({
    subject_type: sp.subject_type,
    kind: sp.kind,
    limit: 300,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Auditoría</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registro inmutable de eventos. {events.length} resultados.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Tipo entidad</label>
              <select
                name="subject_type"
                defaultValue={sp.subject_type ?? ""}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
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
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {Object.entries(EVENT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Aplicar
            </button>
            {(sp.subject_type || sp.kind) && (
              <Link
                href="/auditoria"
                className="text-sm text-muted-foreground hover:underline"
              >
                Limpiar
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eventos</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin eventos.</p>
          ) : (
            <ul className="divide-y">
              {events.map((e) => {
                const link = subjectLink(e.subject_type, e.subject_id);
                return (
                  <li key={e.id} className="grid grid-cols-12 items-center gap-2 py-3 text-sm">
                    <div className="col-span-3 text-xs text-muted-foreground">
                      {new Date(e.occurred_at).toLocaleString("es-ES")}
                    </div>
                    <div className="col-span-2">
                      <Badge variant="outline">
                        {SUBJECT_TYPE_LABEL[e.subject_type] ?? e.subject_type}
                      </Badge>
                    </div>
                    <div className="col-span-3 font-medium">
                      {EVENT_LABEL[e.kind] ?? e.kind}
                    </div>
                    <div className="col-span-2 text-xs text-muted-foreground truncate">
                      {e.actor_name ?? "Sistema"}
                    </div>
                    <div className="col-span-2 text-right">
                      {link && (
                        <Link
                          href={link as never}
                          className="text-xs text-primary hover:underline"
                        >
                          Ver →
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
