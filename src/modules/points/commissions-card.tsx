import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { getPointsRanking } from "./ranking-actions";
import { getPointsSettingsAdmin } from "./config-actions";

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

function eur(n: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Tarjeta admin: muestra el desglose en € por usuario, mes y año en curso,
 * basado en la conversión `euros_per_point` definida en la configuración.
 */
export async function CommissionsCard() {
  const settings = await getPointsSettingsAdmin();
  if (!settings.euros_per_point || settings.euros_per_point <= 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Comisiones (€)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Define un valor de <strong>€ por punto</strong> arriba para activar el desglose
            informativo de comisiones.
          </p>
        </CardContent>
      </Card>
    );
  }
  const ranking = await getPointsRanking({ scope: "all" });
  const totalMes = ranking.reduce((s, r) => s + r.points_month, 0) * settings.euros_per_point;
  const totalAnno = ranking.reduce((s, r) => s + r.points_year, 0) * settings.euros_per_point;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comisiones (€) · cálculo informativo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 text-center">
          <div className="rounded-xl bg-primary/5 p-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">€/punto</div>
            <div className="text-xl font-extrabold text-primary">
              {eur(settings.euros_per_point)}
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">Total mes</div>
            <div className="text-xl font-extrabold text-emerald-700">{eur(totalMes)}</div>
          </div>
          <div className="rounded-xl bg-blue-50 p-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">
              Total año en curso
            </div>
            <div className="text-xl font-extrabold text-blue-700">{eur(totalAnno)}</div>
          </div>
        </div>

        {ranking.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">
            Aún no hay puntos otorgados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Usuario</th>
                  <th className="py-2">Departamento</th>
                  <th className="py-2 text-right">Puntos mes</th>
                  <th className="py-2 text-right">€ mes</th>
                  <th className="py-2 text-right">Puntos año</th>
                  <th className="py-2 text-right">€ año</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r) => (
                  <tr key={r.user_id} className="border-b last:border-0">
                    <td className="py-2 font-semibold">{r.user_name}</td>
                    <td className="py-2 text-muted-foreground">
                      {r.department ? DEPT_LABEL[r.department] : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.points_month}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-emerald-700">
                      {eur(r.points_month * settings.euros_per_point)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.points_year}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-blue-700">
                      {eur(r.points_year * settings.euros_per_point)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          El cálculo es informativo. Los puntos del mes se &laquo;cierran&raquo; al cambiar de mes
          y el año en curso sigue acumulando.
        </p>
      </CardContent>
    </Card>
  );
}
