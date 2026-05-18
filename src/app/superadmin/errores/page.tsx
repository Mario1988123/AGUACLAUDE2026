import { notFound } from "next/navigation";
import Link from "next/link";
import { Bug, Building2, User, Clock } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { listErrorReports } from "@/modules/error-reports/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { ErrorReportRowActions } from "@/modules/error-reports/row-actions";

export const dynamic = "force-dynamic";

const SEVERITY_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  low: "secondary",
  medium: "default",
  high: "warning",
  critical: "destructive",
};

const SEVERITY_LABEL: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const STATUS_LABEL: Record<string, string> = {
  new: "Nuevo",
  triaged: "Revisado",
  in_progress: "En curso",
  resolved: "Resuelto",
  closed: "Cerrado",
  wont_fix: "No se arreglará",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  new: "destructive",
  triaged: "warning",
  in_progress: "default",
  resolved: "success",
  closed: "secondary",
  wont_fix: "secondary",
};

export default async function SuperadminErroresPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; days?: string }>;
}) {
  const session = await requireSession();
  if (!session.is_superadmin) notFound();

  const sp = await searchParams;
  const days = sp.days ? Number(sp.days) : 30;
  const rows = await listErrorReports({
    status: sp.status || undefined,
    severity: sp.severity || undefined,
    days,
  }).catch(() => []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
            <Bug className="h-7 w-7 text-slate-700" />
            Reportes de fallo de clientes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tickets que envían los usuarios de empresas cliente desde el
            botón flotante «Reportar fallo». Solo visible para superadmin.
          </p>
        </div>
        <BackButton href="/superadmin" />
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Periodo</label>
          <select
            name="days"
            defaultValue={String(days)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="1">Últimas 24 h</option>
            <option value="7">7 días</option>
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="365">1 año</option>
          </select>
        </div>
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
          <label className="text-xs uppercase text-muted-foreground">Gravedad</label>
          <select
            name="severity"
            defaultValue={sp.severity ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {Object.entries(SEVERITY_LABEL).map(([k, v]) => (
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
        {(sp.status || sp.severity || sp.days) && (
          <Link
            href="/superadmin/errores"
            className="text-sm text-muted-foreground hover:underline"
          >
            Limpiar
          </Link>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Reportes ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Sin reportes para estos filtros. Cuando un usuario pulse el
              botón flotante «Reportar fallo» aparecerán aquí.
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border bg-card p-4 text-sm"
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={SEVERITY_VARIANT[r.severity] ?? "default"}>
                        {SEVERITY_LABEL[r.severity] ?? r.severity}
                      </Badge>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "default"}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                      {r.company_name && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3" />
                          {r.company_name}
                        </span>
                      )}
                      {r.reported_by_name && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          {r.reported_by_name}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(r.created_at).toLocaleString("es-ES")}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap font-medium">{r.message}</p>
                  {r.steps_to_reproduce && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Pasos para reproducir
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-[11px] font-mono">
                        {r.steps_to_reproduce}
                      </pre>
                    </details>
                  )}
                  {r.route && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      <strong>Ruta:</strong>{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5">{r.route}</code>
                    </div>
                  )}
                  {Object.keys(r.technical_payload).length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Datos técnicos
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-[10px] font-mono">
                        {JSON.stringify(r.technical_payload, null, 2)}
                      </pre>
                    </details>
                  )}
                  {r.internal_notes && (
                    <div className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
                      <strong>Notas internas:</strong> {r.internal_notes}
                    </div>
                  )}
                  <div className="mt-3 border-t pt-3">
                    <ErrorReportRowActions
                      id={r.id}
                      currentStatus={r.status}
                      currentNotes={r.internal_notes}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
