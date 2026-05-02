import { listLoadingRequests, listWarehouses } from "@/modules/warehouses/actions";
import { listWarehouseStockSummary } from "@/modules/warehouses/stock-summary-actions";
import { listTeamMembers } from "@/modules/agenda/actions";
import { listProducts } from "@/modules/products/actions";
import { STATUS_LABEL_LR } from "@/modules/warehouses/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { WarehousesManager } from "@/modules/warehouses/warehouse-form";
import { StockSummaryCards } from "@/modules/warehouses/stock-summary-cards";
import { CreateLoadingRequestButton } from "@/modules/warehouses/loading-request-form";
import { DeliverLoadingRequestButton } from "@/modules/warehouses/deliver-button";

export const dynamic = "force-dynamic";

export default async function AlmacenesPage() {
  const [warehouses, requests, team, stockSummary, products] = await Promise.all([
    listWarehouses(),
    listLoadingRequests(),
    listTeamMembers(),
    listWarehouseStockSummary().catch(() => []),
    listProducts().catch(() => []),
  ]);
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
          <CardTitle>Stock por almacén</CardTitle>
        </CardHeader>
        <CardContent>
          <StockSummaryCards data={stockSummary} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Almacenes y furgonetas</CardTitle>
        </CardHeader>
        <CardContent>
          <WarehousesManager warehouses={warehouses} teamMembers={team} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Solicitudes de carga ({requests.length})</CardTitle>
            <CreateLoadingRequestButton
              warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, kind: w.kind }))}
              products={products.map((p) => ({ id: p.id, name: p.name }))}
            />
          </div>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin solicitudes.</p>
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
    </div>
  );
}
