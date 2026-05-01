import { listMaintenance } from "@/modules/maintenance/actions";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/maintenance/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function MantenimientosPage() {
  const jobs = await listMaintenance();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mantenimientos</h1>
        <p className="text-sm text-muted-foreground">{jobs.length} trabajos</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin mantenimientos programados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Cliente</th>
                  <th className="py-2 text-left">Programado</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-right">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2">{j.customer_name ?? "—"}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {j.scheduled_at ? new Date(j.scheduled_at).toLocaleString("es-ES") : "—"}
                    </td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[j.status]}>
                        {STATUS_LABEL[j.status] ?? j.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {j.is_charged ? formatCents(j.charge_cents) : <span className="text-xs text-muted-foreground">Incluido</span>}
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
