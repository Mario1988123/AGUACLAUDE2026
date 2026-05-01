import { listLoadingRequests, listWarehouses } from "@/modules/warehouses/actions";
import { KIND_LABEL, STATUS_LABEL_LR } from "@/modules/warehouses/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export default async function AlmacenesPage() {
  const [warehouses, requests] = await Promise.all([listWarehouses(), listLoadingRequests()]);
  const whMap = new Map(warehouses.map((w) => [w.id, w.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Almacenes</h1>
        <p className="text-sm text-muted-foreground">
          {warehouses.length} almacenes · {requests.length} solicitudes de carga
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Almacenes y furgonetas</CardTitle>
        </CardHeader>
        <CardContent>
          {warehouses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay almacenes.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Nombre</th>
                  <th className="py-2 text-left">Tipo</th>
                  <th className="py-2 text-left">Matrícula</th>
                  <th className="py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {warehouses.map((w) => (
                  <tr key={w.id}>
                    <td className="py-2 font-medium">{w.name}</td>
                    <td className="py-2 text-xs">{KIND_LABEL[w.kind]}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {w.vehicle_plate ?? "—"}
                    </td>
                    <td className="py-2">
                      {w.is_active ? (
                        <Badge variant="success">Activo</Badge>
                      ) : (
                        <Badge variant="secondary">Inactivo</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Solicitudes de carga</CardTitle>
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
                      <Badge variant="secondary">
                        {STATUS_LABEL_LR[r.status] ?? r.status}
                      </Badge>
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
