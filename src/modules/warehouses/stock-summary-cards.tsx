import { Warehouse, Truck, AlertTriangle, Package } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import type { WarehouseStockSummary } from "./stock-summary-actions";

const KIND_ICON = {
  main: Warehouse,
  secondary: Warehouse,
  vehicle: Truck,
  external_supplier: Package,
} as const;

const KIND_LABEL: Record<string, string> = {
  main: "Principal",
  secondary: "Secundario",
  vehicle: "Vehículo",
  external_supplier: "Proveedor",
};

export function StockSummaryCards({ data }: { data: WarehouseStockSummary[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin almacenes. Crea uno para empezar a gestionar stock.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((w) => {
        const Icon = (KIND_ICON[w.warehouse_kind as keyof typeof KIND_ICON] ?? Warehouse);
        return (
          <div
            key={w.warehouse_id}
            className="rounded-2xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold">{w.warehouse_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {KIND_LABEL[w.warehouse_kind] ?? w.warehouse_kind}
                  </div>
                </div>
              </div>
              {w.low_stock_alerts > 0 && (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> {w.low_stock_alerts}
                </Badge>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Unidades</div>
                <div className="text-xl font-bold tabular-nums">{w.total_units}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Productos</div>
                <div className="text-xl font-bold tabular-nums">{w.distinct_products}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
