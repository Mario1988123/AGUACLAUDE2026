import { listLoadingRequests, listWarehouses } from "@/modules/warehouses/actions";
import { listWarehouseStockSummary } from "@/modules/warehouses/stock-summary-actions";
import { listVanCandidates } from "@/modules/agenda/actions";
import { listProducts } from "@/modules/products/actions";
import { STATUS_LABEL_LR } from "@/modules/warehouses/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { WarehousesManager } from "@/modules/warehouses/warehouse-form";
import { StockSummaryCards } from "@/modules/warehouses/stock-summary-cards";
import { CreateLoadingRequestButton } from "@/modules/warehouses/loading-request-form";
import { DeliverLoadingRequestButton } from "@/modules/warehouses/deliver-button";
import { listStockAlerts } from "@/modules/warehouses/alert-actions";
import { StockAlertsPanel } from "@/modules/warehouses/alerts-panel";
import { getInventoryValuation } from "@/modules/warehouses/import-actions";

export const dynamic = "force-dynamic";

export default async function AlmacenesPage() {
  const [warehouses, requests, team, stockSummary, products, alerts, valuation] =
    await Promise.all([
      listWarehouses(),
      listLoadingRequests(),
      listVanCandidates(),
      listWarehouseStockSummary().catch(() => []),
      listProducts().catch(() => []),
      listStockAlerts({ status: "active" }).catch(() => []),
      getInventoryValuation().catch(() => []),
    ]);
  const totalValuationCents = valuation.reduce(
    (s, v) => s + v.total_value_cents,
    0,
  );
  const fmtEur = (cents: number) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
      cents / 100,
    );
  const KIND_BADGE: Record<string, string> = {
    main: "Principal",
    secondary: "Secundario",
    vehicle: "Furgoneta",
    external_supplier: "Proveedor",
  };
  const whMap = new Map(warehouses.map((w) => [w.id, w.name]));
  const totalAlerts = stockSummary.reduce((s, w) => s + w.low_stock_alerts, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Almacenes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {warehouses.length} almacenes · {requests.length} solicitudes de carga
          {totalAlerts > 0 && ` · ${totalAlerts} alertas stock bajo`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 flex-wrap">
            <span>🧠 Alertas inteligentes</span>
            {alerts.length > 0 && (
              <Badge variant="destructive">{alerts.length} stock</Badge>
            )}
            {(() => {
              const pendingLoads = requests.filter(
                (r) => r.status !== "delivered" && r.status !== "cancelled",
              ).length;
              return pendingLoads > 0 ? (
                <Badge variant="warning">{pendingLoads} cargas pendientes</Badge>
              ) : null;
            })()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StockAlertsPanel alerts={alerts} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between flex-wrap gap-2">
            <span>Almacenes y furgonetas</span>
            <span className="text-xs font-normal text-muted-foreground">
              {warehouses.filter((w) => w.kind !== "vehicle").length} fijos ·{" "}
              {warehouses.filter((w) => w.kind === "vehicle").length} furgonetas
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WarehousesManager warehouses={warehouses} teamMembers={team} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Solicitudes de carga
              {(() => {
                const pendingCount = requests.filter(
                  (r) => r.status !== "delivered" && r.status !== "cancelled",
                ).length;
                return pendingCount > 0 ? (
                  <Badge variant="warning">{pendingCount} pendientes</Badge>
                ) : (
                  <span className="text-xs font-normal text-muted-foreground">
                    {requests.length} total
                  </span>
                );
              })()}
            </CardTitle>
            <CreateLoadingRequestButton
              warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, kind: w.kind }))}
              products={products.map((p) => ({ id: p.id, name: p.name }))}
            />
          </div>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin solicitudes. El sistema genera sugerencias automáticas cada
              noche según las instalaciones agendadas para mañana.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Origen → Destino</th>
                  <th className="py-2 text-left">Para</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">
                      {whMap.get(r.source_warehouse_id) ?? "?"} →{" "}
                      {whMap.get(r.destination_warehouse_id) ?? "?"}
                    </td>
                    <td className="py-2 text-xs">{r.needed_for ?? "—"}</td>
                    <td className="py-2">
                      <Badge variant={r.status === "delivered" ? "success" : "secondary"}>
                        {STATUS_LABEL_LR[r.status] ?? r.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">
                      {r.status !== "delivered" && r.status !== "cancelled" && (
                        <DeliverLoadingRequestButton id={r.id} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {valuation.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between flex-wrap gap-2">
              <span>💰 Valoración del inventario</span>
              <span className="text-2xl font-extrabold tabular-nums">
                {fmtEur(totalValuationCents)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Suma de unidades × coste medio ponderado (CMP) por almacén.
              Refleja el capital inmovilizado.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {valuation.map((v) => (
                <div
                  key={v.warehouse_id}
                  className="rounded-xl border bg-card p-3"
                >
                  <div className="text-xs font-bold uppercase text-muted-foreground">
                    {KIND_BADGE[v.warehouse_kind] ?? v.warehouse_kind}
                  </div>
                  <div className="font-bold">{v.warehouse_name}</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">
                      {v.total_units} ud
                    </span>
                    <span className="text-lg font-extrabold tabular-nums">
                      {fmtEur(v.total_value_cents)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stock por almacén</CardTitle>
        </CardHeader>
        <CardContent>
          <StockSummaryCards data={stockSummary} />
        </CardContent>
      </Card>
    </div>
  );
}
