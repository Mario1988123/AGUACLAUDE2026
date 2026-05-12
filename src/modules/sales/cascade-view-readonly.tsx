import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import type { CascadeDept } from "./cascade-actions";

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function progressBar(actual: number, target: number | null) {
  if (!target || target <= 0) return null;
  const pct = Math.min(150, Math.round((actual * 100) / target));
  const color =
    pct >= 100 ? "bg-success" : pct >= 70 ? "bg-warning" : "bg-destructive";
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full ${color} transition-all`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

/**
 * Vista de SOLO LECTURA de la cascada de objetivos. La edición vive en
 * `/configuracion/objetivos` (decisión usuario 2026-05-12: evitar duplicar
 * la configuración en dos sitios).
 */
export function ObjectivesCascadeReadonly({
  data,
}: {
  data: CascadeDept[];
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <Info className="inline h-4 w-4 -mt-0.5 mr-1" />
        <strong>Resumen del mes.</strong> Esta página muestra el cumplimiento
        del mes en cascada (departamento → usuario). Para crear o modificar
        targets ve a{" "}
        <Link
          href="/configuracion/objetivos"
          className="font-bold underline"
        >
          /configuracion/objetivos
        </Link>
        .
      </div>

      {data.length === 0 && (
        <Card>
          <CardContent className="pt-6 space-y-2 text-center">
            <p className="text-sm text-muted-foreground">
              Aún no hay objetivos definidos para este mes.
            </p>
            <Link
              href="/configuracion/objetivos"
              className="inline-flex items-center text-sm font-semibold text-primary hover:underline"
            >
              Configurar objetivos →
            </Link>
          </CardContent>
        </Card>
      )}

      {data.map((dept) => {
        const distributedVsTarget = dept.dept_target_amount_cents
          ? Math.round(
              (dept.distributed_amount_cents * 100) /
                dept.dept_target_amount_cents,
            )
          : null;
        const matchVariant: "success" | "warning" | "destructive" | "default" =
          distributedVsTarget == null
            ? "default"
            : distributedVsTarget < 80
              ? "destructive"
              : distributedVsTarget > 120
                ? "warning"
                : "success";
        return (
          <Card key={dept.department}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2">
                  🎯 Departamento {dept.department_label}
                </span>
                <Badge variant={matchVariant}>
                  Distribuido: {eur(dept.distributed_amount_cents)} /{" "}
                  {dept.dept_target_amount_cents
                    ? `${eur(dept.dept_target_amount_cents)} (${distributedVsTarget}%)`
                    : "sin objetivo dpto"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="text-sm font-bold uppercase tracking-wide text-primary">
                  Objetivo del departamento (informativo)
                </div>
                <div className="grid gap-2 sm:grid-cols-3 text-sm">
                  <div className="rounded-lg bg-card p-2">
                    <div className="text-xs text-muted-foreground">
                      Target €
                    </div>
                    <div className="font-bold tabular-nums">
                      {eur(dept.dept_target_amount_cents)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-card p-2">
                    <div className="text-xs text-muted-foreground">
                      Target uds
                    </div>
                    <div className="font-bold tabular-nums">
                      {dept.dept_target_units ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-lg bg-card p-2">
                    <div className="text-xs text-muted-foreground">
                      Realizado del mes
                    </div>
                    <div className="font-bold tabular-nums">
                      {eur(dept.actual_amount_cents)} · {dept.actual_units}{" "}
                      ventas
                    </div>
                    {progressBar(
                      dept.actual_amount_cents,
                      dept.dept_target_amount_cents,
                    )}
                  </div>
                </div>
                {dept.dept_target_amount_cents && distributedVsTarget != null && (
                  <div className="text-[11px]">
                    {distributedVsTarget < 80 && (
                      <span className="text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> La suma
                        distribuida queda corta ({distributedVsTarget}% del
                        target del dpto).
                      </span>
                    )}
                    {distributedVsTarget >= 80 && distributedVsTarget <= 120 && (
                      <span className="text-success flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Distribución
                        coherente ({distributedVsTarget}%).
                      </span>
                    )}
                    {distributedVsTarget > 120 && (
                      <span className="text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Has pasado el
                        target del dpto ({distributedVsTarget}%).
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-bold mb-2">
                  Distribución por miembro ({dept.users.length}{" "}
                  {dept.department_label.toLowerCase()})
                </h3>
                {dept.users.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                    Sin usuarios en este departamento.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Miembro</th>
                          <th className="px-3 py-2 text-right">Target €</th>
                          <th className="px-3 py-2 text-right">Target uds</th>
                          <th className="px-3 py-2 text-right">Realizado €</th>
                          <th className="px-3 py-2 text-right">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {dept.users.map((u) => {
                          const pct =
                            u.user_target_amount_cents != null &&
                            u.user_target_amount_cents > 0
                              ? Math.round(
                                  (u.user_actual_amount_cents * 100) /
                                    u.user_target_amount_cents,
                                )
                              : null;
                          return (
                            <tr key={u.user_id}>
                              <td className="px-3 py-2 font-medium">
                                {u.full_name}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {eur(u.user_target_amount_cents)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {u.user_target_units ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {eur(u.user_actual_amount_cents)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {pct != null ? (
                                  <Badge
                                    variant={
                                      pct >= 100
                                        ? "success"
                                        : pct >= 70
                                          ? "warning"
                                          : "destructive"
                                    }
                                  >
                                    {pct}%
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-xs">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
