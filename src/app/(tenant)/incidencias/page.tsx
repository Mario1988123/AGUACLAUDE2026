import { listIncidents } from "@/modules/incidents/actions";
import {
  STATUS_LABEL,
  STATUS_VARIANT,
  PRIORITY_LABEL,
  PRIORITY_VARIANT,
  ORIGIN_LABEL,
} from "@/modules/incidents/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export default async function IncidenciasPage() {
  const incidents = await listIncidents();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Incidencias</h1>
        <p className="text-sm text-muted-foreground">{incidents.length} incidencias</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin incidencias.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Ref.</th>
                  <th className="py-2 text-left">Título</th>
                  <th className="py-2 text-left">Origen</th>
                  <th className="py-2 text-left">Prioridad</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-left">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {incidents.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 font-mono text-xs">{i.reference_code ?? "—"}</td>
                    <td className="py-2">{i.title}</td>
                    <td className="py-2 text-xs">{ORIGIN_LABEL[i.origin] ?? i.origin}</td>
                    <td className="py-2">
                      <Badge variant={PRIORITY_VARIANT[i.priority]}>
                        {PRIORITY_LABEL[i.priority]}
                      </Badge>
                    </td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[i.status] ?? "default"}>
                        {STATUS_LABEL[i.status] ?? i.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {new Date(i.created_at).toLocaleDateString("es-ES")}
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
