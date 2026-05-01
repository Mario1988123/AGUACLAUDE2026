import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Agendada",
  installed: "Instalada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  removed: "Retirada",
  expired: "Caducada",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  draft: "secondary",
  scheduled: "default",
  installed: "warning",
  accepted: "success",
  rejected: "destructive",
  removed: "outline",
  expired: "outline",
};

interface Row {
  id: string;
  reference_code: string | null;
  status: string;
  customer_id: string | null;
  lead_id: string | null;
  scheduled_at: string | null;
  installed_at: string | null;
  expires_at: string | null;
}

export default async function PruebasGratuitasPage() {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("free_trials")
    .select("id, reference_code, status, customer_id, lead_id, scheduled_at, installed_at, expires_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pruebas gratuitas</h1>
        <p className="text-sm text-muted-foreground">{rows.length} pruebas</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin pruebas. Se generan desde la ficha de un cliente o lead.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Ref.</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-left">Instalada</th>
                  <th className="py-2 text-left">Caduca</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 font-mono text-xs">{r.reference_code ?? "—"}</td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[r.status]}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {r.installed_at
                        ? new Date(r.installed_at).toLocaleDateString("es-ES")
                        : "—"}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {r.expires_at
                        ? new Date(r.expires_at).toLocaleDateString("es-ES")
                        : "—"}
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
