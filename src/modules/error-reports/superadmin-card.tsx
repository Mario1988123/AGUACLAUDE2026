import Link from "next/link";
import { AlertCircle, Bug } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { countOpenErrorReports, listErrorReports } from "./actions";

export async function ErrorReportsSuperadminCard() {
  const [counts, latest] = await Promise.all([
    countOpenErrorReports().catch(() => ({
      new: 0,
      in_progress: 0,
      by_severity: { critical: 0, high: 0 },
    })),
    listErrorReports({ days: 7 }).catch(() => []),
  ]);
  const totalOpen = counts.new + counts.in_progress;

  if (totalOpen === 0 && latest.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="py-4 text-sm text-emerald-900">
          ✓ Sin reportes de fallo abiertos. Última semana sin tickets.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={counts.by_severity.critical > 0 ? "border-2 border-red-300" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-slate-700" />
            Reportes de fallo de clientes
            {totalOpen > 0 && <Badge variant="destructive">{totalOpen} abiertos</Badge>}
          </span>
          <Link
            href={"/superadmin/errores" as never}
            className="text-xs font-bold text-primary hover:underline"
          >
            Ver todos →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <Link
            href={"/superadmin/errores?status=new" as never}
            className="rounded-xl border-2 border-red-200 bg-red-50/50 p-3 hover:bg-red-50"
          >
            <div className="text-xs font-bold uppercase text-red-900">Nuevos</div>
            <div className="text-2xl font-extrabold tabular-nums text-red-900">
              {counts.new}
            </div>
          </Link>
          <Link
            href={"/superadmin/errores?status=in_progress" as never}
            className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-3 hover:bg-amber-50"
          >
            <div className="text-xs font-bold uppercase text-amber-900">En curso</div>
            <div className="text-2xl font-extrabold tabular-nums text-amber-900">
              {counts.in_progress}
            </div>
          </Link>
          <Link
            href={"/superadmin/errores?severity=critical" as never}
            className="rounded-xl border-2 border-red-300 bg-red-100/50 p-3 hover:bg-red-100"
          >
            <div className="text-xs font-bold uppercase text-red-900">Críticos abiertos</div>
            <div className="text-2xl font-extrabold tabular-nums text-red-900">
              {counts.by_severity.critical}
            </div>
          </Link>
          <Link
            href={"/superadmin/errores?severity=high" as never}
            className="rounded-xl border-2 border-orange-200 bg-orange-50/50 p-3 hover:bg-orange-50"
          >
            <div className="text-xs font-bold uppercase text-orange-900">Altos abiertos</div>
            <div className="text-2xl font-extrabold tabular-nums text-orange-900">
              {counts.by_severity.high}
            </div>
          </Link>
        </div>

        {latest.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Últimos 7 días
            </h3>
            <ul className="space-y-1.5">
              {latest.slice(0, 5).map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-2 rounded-lg border bg-card p-2 text-xs"
                >
                  <AlertCircle
                    className={`h-4 w-4 shrink-0 ${
                      r.severity === "critical"
                        ? "text-red-700"
                        : r.severity === "high"
                          ? "text-orange-600"
                          : "text-slate-500"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 font-semibold">{r.message}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.company_name ?? "Empresa desconocida"}
                      {r.reported_by_name && ` · ${r.reported_by_name}`} ·{" "}
                      {new Date(r.created_at).toLocaleString("es-ES")}
                    </div>
                  </div>
                  <Link
                    href={"/superadmin/errores" as never}
                    className="text-[11px] font-bold text-primary hover:underline shrink-0"
                  >
                    Ver
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
