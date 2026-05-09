"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { updateProductAction } from "./actions";
import type { SalesHistoryPoint, ProductStockSummary } from "./stock-actions";

interface Props {
  productId: string;
  initial: {
    stock_managed: boolean;
    stock_min: number;
    stock_max: number | null;
    lead_time_days: number | null;
    default_supplier_name: string | null;
  };
  summary: ProductStockSummary;
  history: SalesHistoryPoint[];
}

const KIND_BADGE: Record<string, string> = {
  main: "Principal",
  secondary: "Secundario",
  vehicle: "Furgoneta",
  external_supplier: "Proveedor",
};

export function ProductStockPanel({ productId, initial, summary, history }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [stockManaged, setStockManaged] = useState(initial.stock_managed);
  const [stockMin, setStockMin] = useState(String(initial.stock_min ?? 0));
  const [stockMax, setStockMax] = useState(
    initial.stock_max != null ? String(initial.stock_max) : "",
  );
  const [leadTime, setLeadTime] = useState(
    initial.lead_time_days != null ? String(initial.lead_time_days) : "",
  );
  const [supplier, setSupplier] = useState(initial.default_supplier_name ?? "");

  function save() {
    const minN = Math.max(0, Math.floor(Number(stockMin)));
    const maxN = stockMax.trim() === "" ? null : Math.max(0, Math.floor(Number(stockMax)));
    const ltN = leadTime.trim() === "" ? null : Math.max(0, Math.floor(Number(leadTime)));
    if (maxN != null && maxN < minN) {
      notify.warning("Máximo debe ser ≥ mínimo");
      return;
    }
    startTransition(async () => {
      const r = await updateProductAction(productId, {
        stock_managed: stockManaged,
        stock_min: minN,
        stock_max: maxN,
        lead_time_days: ltN,
        default_supplier_name: supplier.trim() || null,
      });
      if (r.ok) {
        notify.success("Stock actualizado");
        router.refresh();
      } else {
        notify.error("Error", r.error);
      }
    });
  }

  // Cálculo predictivo
  const dailyRate = computeDailyRate(history);
  const lt = leadTime.trim() === "" ? null : Number(leadTime);
  const min = Number(stockMin) || 0;
  const projection = computeProjection({
    stockTotal: summary.total,
    dailyRate,
    leadTimeDays: lt,
    stockMin: min,
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Proveedor habitual</Label>
          <Input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Senda Aguas, Filtros XYZ…"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Plazo reposición (días)</Label>
          <Input
            type="number"
            min={0}
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            placeholder="Ej: 4"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Stock mínimo (global)</Label>
          <Input
            type="number"
            min={0}
            value={stockMin}
            onChange={(e) => setStockMin(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Stock máximo (informativo)</Label>
          <Input
            type="number"
            min={0}
            value={stockMax}
            onChange={(e) => setStockMax(e.target.value)}
            placeholder="Sin límite"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 rounded-xl border bg-muted/30 p-3">
        <input
          type="checkbox"
          checked={stockManaged}
          onChange={(e) => setStockManaged(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm font-semibold">
          Controlar stock de este producto (alertas + predicción)
        </span>
      </label>
      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" />
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Stock por almacén
          </h3>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm">Total</span>
              <span className="text-2xl font-extrabold tabular-nums">
                {summary.total}
              </span>
            </div>
            {summary.by_warehouse.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin stock en ningún almacén.
              </p>
            ) : (
              <ul className="divide-y">
                {summary.by_warehouse.map((w) => (
                  <li key={w.warehouse_id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium">{w.warehouse_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {KIND_BADGE[w.warehouse_kind] ?? w.warehouse_kind}
                      </div>
                    </div>
                    <span className="text-lg font-bold tabular-nums">{w.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Predicción (últimos 90 días)
          </h3>
          <div className="space-y-3 text-sm">
            <Row label="Ritmo medio diario">
              {dailyRate.toFixed(2)} ud/día
            </Row>
            <Row label="Días hasta agotar">
              {projection.daysToZero == null ? "—" : `${projection.daysToZero} días`}
            </Row>
            <Row label="Días hasta llegar al mínimo">
              {projection.daysToMin == null ? "—" : `${projection.daysToMin} días`}
            </Row>
            {projection.alert ? (
              <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <div className="font-bold text-destructive">⚠ Alerta predictiva</div>
                <p className="mt-1 text-xs text-destructive/90">
                  {projection.alertMessage}
                </p>
              </div>
            ) : (
              <Badge variant="success">Stock controlado</Badge>
            )}
          </div>
          <Sparkline history={history} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold tabular-nums">{children}</span>
    </div>
  );
}

function computeDailyRate(history: SalesHistoryPoint[]): number {
  if (history.length === 0) return 0;
  const total = history.reduce((s, p) => s + p.outbound, 0);
  // Repartimos sobre los días observados o, si hay pocos, sobre 90 para no
  // sobrestimar con un único pico.
  const span = Math.max(history.length, 30);
  return total / span;
}

function computeProjection(args: {
  stockTotal: number;
  dailyRate: number;
  leadTimeDays: number | null;
  stockMin: number;
}): {
  daysToZero: number | null;
  daysToMin: number | null;
  alert: boolean;
  alertMessage: string;
} {
  if (args.dailyRate <= 0) {
    return { daysToZero: null, daysToMin: null, alert: false, alertMessage: "" };
  }
  const daysToZero = Math.floor(args.stockTotal / args.dailyRate);
  const daysToMin = Math.max(
    0,
    Math.floor((args.stockTotal - args.stockMin) / args.dailyRate),
  );

  let alert = false;
  let alertMessage = "";
  if (args.leadTimeDays != null && daysToMin <= args.leadTimeDays) {
    alert = true;
    alertMessage = `Al ritmo actual (${args.dailyRate.toFixed(2)} ud/día) llegarás al mínimo en ${daysToMin} día(s), pero el plazo de reposición es de ${args.leadTimeDays}. Pide ya.`;
  } else if (args.stockTotal <= args.stockMin) {
    alert = true;
    alertMessage = `Stock actual (${args.stockTotal}) ya está en o por debajo del mínimo (${args.stockMin}). Reposición urgente.`;
  }
  return { daysToZero, daysToMin, alert, alertMessage };
}

function Sparkline({ history }: { history: SalesHistoryPoint[] }) {
  if (history.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Sin salidas registradas en los últimos 90 días.
      </p>
    );
  }
  const max = Math.max(...history.map((p) => p.outbound), 1);
  const w = 240;
  const h = 60;
  const dx = w / Math.max(history.length - 1, 1);
  const points = history
    .map((p, i) => `${i * dx},${h - (p.outbound / max) * h}`)
    .join(" ");
  return (
    <div className="mt-4 space-y-1">
      <div className="text-xs text-muted-foreground">Salidas diarias (90d)</div>
      <svg width={w} height={h} className="text-primary">
        <polyline fill="none" stroke="currentColor" strokeWidth={1.5} points={points} />
      </svg>
    </div>
  );
}
