import { listInstallations } from "@/modules/installations/actions";
import { STATUS_LABEL, STATUS_VARIANT, KIND_LABEL } from "@/modules/installations/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export default async function InstalacionesPage() {
  const installations = await listInstallations();
  const grouped = installations.reduce<Record<string, typeof installations>>((acc, i) => {
    (acc[i.status] = acc[i.status] ?? []).push(i);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Instalaciones</h1>
        <p className="text-sm text-muted-foreground">{installations.length} instalaciones</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {installations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay instalaciones. Se crean desde un contrato firmado o como reubicación.
            </p>
          ) : (
            <div className="space-y-6">
              {Object.entries(grouped).map(([status, items]) => (
                <div key={status}>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-2 text-left">Cliente</th>
                        <th className="py-2 text-left">Tipo</th>
                        <th className="py-2 text-left">Programada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((i) => (
                        <tr key={i.id}>
                          <td className="py-2">{i.customer_name ?? "—"}</td>
                          <td className="py-2 text-xs">{KIND_LABEL[i.kind] ?? i.kind}</td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {i.scheduled_at
                              ? new Date(i.scheduled_at).toLocaleString("es-ES")
                              : "Sin agendar"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
