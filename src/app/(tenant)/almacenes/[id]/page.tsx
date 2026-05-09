import { notFound } from "next/navigation";
import { listWarehouses } from "@/modules/warehouses/actions";
import { getWarehouse, listStockMovements } from "@/modules/warehouses/inventory-actions";
import { getWarehouseStockDetail } from "@/modules/warehouses/stock-summary-actions";
import {
  listWarehouseLocations,
  listProductLocations,
} from "@/modules/warehouses/location-actions";
import { listPurchases, getPurchase } from "@/modules/warehouses/purchase-actions";
import { listReservations } from "@/modules/warehouses/reservation-actions";
import { listNonNewStock } from "@/modules/warehouses/used-stock-actions";
import { UsedStockPanel } from "@/modules/warehouses/used-stock-panel";
import { createClient } from "@/shared/lib/supabase/server";
import { listProducts } from "@/modules/products/actions";
import { WarehouseDetailTabs } from "@/modules/warehouses/warehouse-detail-tabs";
import { KIND_LABEL } from "@/modules/warehouses/constants";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

export const dynamic = "force-dynamic";

export default async function WarehouseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const wh = await getWarehouse(id);
  if (!wh) notFound();

  const [
    stock,
    movements,
    products,
    allWarehouses,
    locations,
    productLocations,
    purchases,
    reservations,
  ] = await Promise.all([
    getWarehouseStockDetail(id).catch(() => []),
    listStockMovements(id).catch(() => []),
    listProducts({ active_only: true }).catch(() => []),
    listWarehouses().catch(() => []),
    listWarehouseLocations(id).catch(() => []),
    listProductLocations(id).catch(() => []),
    listPurchases(id).catch(() => []),
    listReservations({ warehouse_id: id, status: "active" }).catch(() => []),
  ]);
  const usedStock = await listNonNewStock(id).catch(() => []);

  // Detalles de compras (carga upfront — cuando crezca, paginar / lazy)
  const purchaseDetailsList = await Promise.all(
    purchases.map((p) => getPurchase(p.id).catch(() => null)),
  );
  const purchaseDetails = new Map(
    purchaseDetailsList
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => [d.id, d]),
  );

  const otherWarehouses = allWarehouses.filter((w) => w.id !== id);
  // Para la tab Compras precargamos coste actual + proveedor habitual
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any;
  let extra: Array<{
    id: string;
    cost_cents: number | null;
    default_supplier_name: string | null;
  }> = [];
  if (products.length > 0) {
    try {
      const { data } = await sb
        .from("products")
        .select("id, cost_cents, default_supplier_name")
        .in(
          "id",
          products.map((p) => p.id),
        );
      extra = (data ?? []) as typeof extra;
    } catch {
      /* migración aún no aplicada */
    }
  }
  const extraMap = new Map(extra.map((e) => [e.id, e]));
  const productLite = products.map((p) => ({
    id: p.id,
    name: p.name,
    cost_cents: extraMap.get(p.id)?.cost_cents ?? null,
    default_supplier_name: extraMap.get(p.id)?.default_supplier_name ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">{wh.name}</h1>
            <Badge variant="outline">{KIND_LABEL[wh.kind]}</Badge>
            {wh.vehicle_plate && <Badge variant="secondary">{wh.vehicle_plate}</Badge>}
            {!wh.is_active && <Badge variant="destructive">Inactivo</Badge>}
          </div>
          {wh.notes && (
            <p className="mt-1 text-sm text-muted-foreground">{wh.notes}</p>
          )}
        </div>
        <BackButton href="/almacenes" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operaciones del almacén</CardTitle>
        </CardHeader>
        <CardContent>
          <WarehouseDetailTabs
            warehouseId={id}
            stock={stock}
            movements={movements}
            products={productLite}
            otherWarehouses={otherWarehouses.map((w) => ({ id: w.id, name: w.name }))}
            locations={locations}
            productLocations={productLocations}
            purchases={purchases}
            purchaseDetails={purchaseDetails}
            reservations={reservations}
          />
        </CardContent>
      </Card>

      {usedStock.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              ♻ Stock no-nuevo (usado / dañado / reacondicionado)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UsedStockPanel rows={usedStock} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
