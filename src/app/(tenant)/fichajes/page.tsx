import Link from "next/link";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { getMyHourBalance } from "@/modules/time-tracking/balance";
import { listAbsences } from "@/modules/time-tracking/absences-actions";
import { Badge } from "@/shared/ui/badge";
import { SubmitAbsenceButton } from "@/modules/time-tracking/submit-absence-button";

export const dynamic = "force-dynamic";

function fmtMin(m: number): string {
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m`;
}

const KIND_LABEL: Record<string, string> = {
  vacation: "Vacaciones",
  sick: "Baja",
  personal: "Asunto personal",
  training: "Formación",
  other: "Otro",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

export default async function FichajesPage() {
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);
  const [balance, accumulated, absences] = await Promise.all([
    getMyHourBalance(monthStart, monthEnd),
    getMyHourBalance(yearStart, todayStr),
    listAbsences(),
  ]);

  const totalWorked = balance.reduce((s, d) => s + d.worked_minutes, 0);
  const totalExpected = balance.reduce((s, d) => s + d.expected_minutes, 0);
  const totalBalance = totalWorked - totalExpected;
  const accumulatedBalance = accumulated.reduce((s, d) => s + d.balance_minutes, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Fichajes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saldo del mes en curso. Pulsa el botón &laquo;Fichar&raquo; del header para registrar
            entrada o salida.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SubmitAbsenceButton />
          {isAdmin && (
            <Button asChild variant="outline">
              <Link href={"/fichajes/admin" as never}>Vista admin →</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Trabajado (mes)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold">{fmtMin(totalWorked)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Esperado (mes)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-muted-foreground">
              {fmtMin(totalExpected)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Saldo (mes)</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-extrabold ${
                totalBalance >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {fmtMin(totalBalance)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Acumulado año</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-extrabold ${
                accumulatedBalance >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {fmtMin(accumulatedBalance)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {accumulatedBalance >= 0 ? "Horas de más" : "Horas de menos"} desde 1 ene
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Días del mes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Fecha</th>
                  <th className="py-2 text-right">Trabajado</th>
                  <th className="py-2 text-right">Esperado</th>
                  <th className="py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {balance.map((d) => (
                  <tr key={d.date} className="border-b last:border-0">
                    <td className="py-1.5 capitalize">
                      {new Date(d.date).toLocaleDateString("es-ES", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMin(d.worked_minutes)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {fmtMin(d.expected_minutes)}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums font-semibold ${
                        d.balance_minutes >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {fmtMin(d.balance_minutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mis ausencias</CardTitle>
        </CardHeader>
        <CardContent>
          {absences.length === 0 ? (
            <p className="text-sm text-muted-foreground">No has solicitado ausencias.</p>
          ) : (
            <ul className="divide-y">
              {absences.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-semibold">
                      {KIND_LABEL[a.kind]} · {new Date(a.starts_on).toLocaleDateString("es-ES")}
                      {" → "}
                      {new Date(a.ends_on).toLocaleDateString("es-ES")}
                    </div>
                    {a.notes && (
                      <div className="text-xs text-muted-foreground">{a.notes}</div>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
