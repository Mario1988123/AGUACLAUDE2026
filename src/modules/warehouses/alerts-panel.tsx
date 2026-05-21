"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  X,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  recomputeStockAlertsAction,
  dismissAlertSafeAction,
  type StockAlert,
} from "./alert-actions";

const KIND_LABEL: Record<StockAlert["kind"], string> = {
  predictive_low: "Predicción: vas a romper stock",
  below_min: "Por debajo del mínimo",
  over_max: "Sobrestock",
  no_rotation_90d: "Sin rotación 90 días",
  no_lead_time_set: "Falta plazo de reposición",
};

function severityIcon(sev: StockAlert["severity"]) {
  if (sev === "critical") return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (sev === "warning") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
}

export function StockAlertsPanel({ alerts }: { alerts: StockAlert[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | StockAlert["kind"]>("all");

  const grouped = {
    critical: alerts.filter((a) => a.severity === "critical"),
    warning: alerts.filter((a) => a.severity === "warning"),
    info: alerts.filter((a) => a.severity === "info"),
  };

  const filtered = filter === "all" ? alerts : alerts.filter((a) => a.kind === filter);

  function recompute() {
    startTransition(async () => {
      const r = await recomputeStockAlertsAction();
      if (r.ok) {
        notify.success("Alertas recalculadas", `${r.total} activa(s)`);
        router.refresh();
      } else {
        notify.error("Error", r.error);
      }
    });
  }

  function dismiss(id: string) {
    startTransition(async () => {
      const r = await dismissAlertSafeAction(id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Descartada");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="destructive">{grouped.critical.length} críticas</Badge>
          <Badge variant="warning">{grouped.warning.length} advertencias</Badge>
          <Badge variant="secondary">{grouped.info.length} info</Badge>
        </div>
        <Button onClick={recompute} disabled={pending} size="sm" variant="outline">
          <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Recalculando…" : "Recalcular ahora"}
        </Button>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-success/40 bg-success/5 p-6 text-center text-sm">
          ✓ Stock controlado. Sin alertas activas.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(["all", "below_min", "predictive_low", "over_max", "no_rotation_90d", "no_lead_time_set"] as const).map(
              (k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    filter === k
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {k === "all" ? "Todas" : KIND_LABEL[k]}
                </button>
              ),
            )}
          </div>
          <ul className="space-y-2">
            {filtered.map((a) => (
              <li
                key={a.id}
                className={`flex items-start gap-3 rounded-xl border p-3 ${
                  a.severity === "critical"
                    ? "border-destructive/40 bg-destructive/5"
                    : a.severity === "warning"
                      ? "border-warning/40 bg-warning/5"
                      : "border-border bg-card"
                }`}
              >
                <div className="mt-0.5">{severityIcon(a.severity)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{KIND_LABEL[a.kind]}</Badge>
                    <Link
                      href={`/productos/${a.product_id}` as never}
                      className="font-bold hover:underline"
                    >
                      {a.product_name}
                    </Link>
                    {a.warehouse_name && (
                      <span className="text-xs text-muted-foreground">
                        · {a.warehouse_name}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm">{a.message}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => dismiss(a.id)}
                  disabled={pending}
                  title="Descartar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
