import Link from "next/link";
import { listCycles } from "@/modules/points/cycles-actions";
import { getPointsSettingsAdmin } from "@/modules/points/config-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import {
  MyCommissionsCard,
  getMyCommissionData,
} from "@/modules/points/my-commissions-card";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function formatEur(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  pending_review: "Pendiente revisión",
  closed: "Cerrado",
};

export default async function ComisionesPage() {
  await assertModuleActive("commissions");
  const session = await requireSession();
  const canManage =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");

  const [cycles, settings, myData] = await Promise.all([
    listCycles(),
    getPointsSettingsAdmin().catch(() => null),
    getMyCommissionData(session.user_id).catch(() => null),
  ]);

  const closeDayLabel =
    !settings || (settings.cycle_close_day ?? 0) === 0
      ? "Fin de mes natural"
      : `Día ${settings.cycle_close_day} → Día ${(settings.cycle_close_day - 1) || 28}`;
  const eurPerPoint = settings?.euros_per_point ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Comisiones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cierre por ciclos de los puntos acumulados, equivalente en €. Solo informativo
          — el dato cerrado se traslada manualmente a nómina.
        </p>
      </div>

      {myData && <MyCommissionsCard data={myData} />}

      <Card>
        <CardHeader>
          <CardTitle>Configuración actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-primary/5 p-3">
              <div className="text-xs font-bold uppercase text-muted-foreground">
                Cierre del ciclo
              </div>
              <div className="mt-1 text-base font-bold">{closeDayLabel}</div>
            </div>
            <div className="rounded-xl bg-primary/5 p-3">
              <div className="text-xs font-bold uppercase text-muted-foreground">
                Conversión € / punto
              </div>
              <div className="mt-1 text-base font-bold tabular-nums">
                {eurPerPoint > 0
                  ? new Intl.NumberFormat("es-ES", {
                      style: "currency",
                      currency: "EUR",
                      maximumFractionDigits: 4,
                    }).format(eurPerPoint)
                  : "Desactivado"}
              </div>
            </div>
          </div>
          {(eurPerPoint <= 0 || !settings) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Define la conversión en{" "}
              <Link href="/configuracion/puntos" className="text-primary hover:underline">
                Configuración &gt; Puntos
              </Link>{" "}
              para ver los importes en €.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ciclos</CardTitle>
        </CardHeader>
        <CardContent>
          {cycles.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay ciclos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2">Periodo</th>
                    <th className="py-2">Rango</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">Puntos</th>
                    <th className="py-2 text-right">€</th>
                    <th className="py-2">Cerrado por</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cycles.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 font-bold">
                        {MONTH_NAMES[c.cycle_month - 1]} {c.cycle_year}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {formatDate(c.cycle_start_at)} → {formatDate(c.cycle_end_at)}
                      </td>
                      <td className="py-2">
                        <Badge
                          variant={
                            c.status === "closed"
                              ? "outline"
                              : c.status === "pending_review"
                                ? "secondary"
                                : "success"
                          }
                        >
                          {STATUS_LABEL[c.status] ?? c.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {c.status === "closed" ? c.total_points : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums font-semibold">
                        {c.status === "closed" ? formatEur(c.total_cents) : "—"}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {c.closed_by_name ?? "—"}
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/comisiones/${c.id}` as never}
                          className="text-xs font-bold text-primary hover:underline"
                        >
                          Ver detalle →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!canManage && (
            <p className="mt-3 text-xs text-muted-foreground">
              Solo lectura. Para cerrar ciclos o ajustar puntos necesitas rol{" "}
              <strong>director comercial</strong> o <strong>admin</strong>.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
