import { notFound } from "next/navigation";
import { listWarehouses } from "@/modules/warehouses/actions";
import { getWarehouse, listStockMovements } from "@/modules/warehouses/inventory-actions";
import { getWarehouseStockDetail } from "@/modules/warehouses/stock-summary-actions";
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

  const [stock, movements, products, allWarehouses] = await Promise.all([
    getWarehouseStockDetail(id).catch(() => []),
    listStockMovements(id).catch(() => []),
    listProducts({ active_only: true }).catch(() => []),
    listWarehouses().catch(() => []),
  ]);

  const otherWarehouses = allWarehouses.filter((w) => w.id !== id);
  const productLite = products.map((p) => ({ id: p.id, name: p.name }));

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
          />
        </CardContent>
      </Card>
    </div>
  );
}
