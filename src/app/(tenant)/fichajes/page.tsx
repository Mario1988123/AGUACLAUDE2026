import Link from "next/link";
import { ChevronLeft, ChevronRight, Ghost, AlertTriangle } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { getMyHourBalance } from "@/modules/time-tracking/balance";
import { listAbsences } from "@/modules/time-tracking/absences-actions";
import { Badge } from "@/shared/ui/badge";
import { SubmitAbsenceButton } from "@/modules/time-tracking/submit-absence-button";
import { PunchRequestButton } from "@/modules/time-tracking/punch-request-button";
import { listMyPunchRequests } from "@/modules/time-tracking/punch-requests-actions";

export const dynamic = "force-dynamic";

function fmtMin(m: number): string {
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}h ${String(abs % 60).padStart(2, "0")}min`;
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

/** Devuelve el lunes de la semana que contiene `d` (en hora local). */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // 0=Lun
  x.setDate(x.getDate() - dow);
  return x;
}

function isoLocal(d: Date): string {
  // YYYY-MM-DD en hora local
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export default async function FichajesPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await assertModuleActive("time_tracking");
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

  const sp = await searchParams;
  const now = new Date();
  // Semana visible: ?week=YYYY-MM-DD (lunes) o lunes de esta semana
  let weekStart: Date;
  if (sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week)) {
    weekStart = mondayOf(new Date(sp.week + "T00:00:00"));
  } else {
    weekStart = mondayOf(now);
  }
  const weekEnd = addDays(weekStart, 6);
  const prevWeek = isoLocal(addDays(weekStart, -7));
  const nextWeek = isoLocal(addDays(weekStart, 7));

  // Datos del mes para los KPIs y vista semanal
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const todayStr = isoLocal(now);

  const [weekBalance, monthBalance, accumulated, absencesAll, myRequests] =
    await Promise.all([
      getMyHourBalance(isoLocal(weekStart), isoLocal(weekEnd)),
      getMyHourBalance(monthStart, monthEnd),
      getMyHourBalance(yearStart, todayStr),
      listAbsences(),
      listMyPunchRequests().catch(() => []),
    ]);

  const today = weekBalance.find((d) => d.date === todayStr);
  const totalWorked = monthBalance.reduce((s, d) => s + d.worked_minutes, 0);
  const totalExpected = monthBalance.reduce((s, d) => s + d.expected_minutes, 0);
  const totalBalance = totalWorked - totalExpected;
  const accumulatedBalance = accumulated.reduce((s, d) => s + d.balance_minutes, 0);

  // Mapa día → ausencia aprobada que solape (para chip intercalado)
  const approvedAbsences = absencesAll.filter((a) => a.status === "approved");
  function absenceFor(dateStr: string): { kind: string; label: string } | null {
    const d = new Date(dateStr + "T12:00:00");
    for (const a of approvedAbsences) {
      const s = new Date(a.starts_on + "T00:00:00");
      const e = new Date(a.ends_on + "T23:59:59");
      if (d >= s && d <= e) {
        return { kind: a.kind, label: KIND_LABEL[a.kind] ?? a.kind };
      }
    }
    return null;
  }

  const weekRangeLabel = (() => {
    const from = weekStart.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    const to = weekEnd.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    return `${from} – ${to}`;
  })();

  const todayBalance = today?.balance_minutes ?? 0;
  const todayWorked = today?.worked_minutes ?? 0;
  const todayExpected = today?.expected_minutes ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Fichajes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu jornada, saldo semanal y solicitudes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="success" className="gap-2">
            <Link href={"/fichajes/fichar" as never}>📍 Fichar ahora</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={"/fichajes/equipo" as never}>Quién está</Link>
          </Button>
          <PunchRequestButton />
          <SubmitAbsenceButton />
          {isAdmin && (
            <Button asChild variant="outline">
              <Link href={"/fichajes/admin" as never}>Vista admin →</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Saldo HOY prominente */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Saldo de hoy
            </div>
            <div
              className={`mt-1 text-5xl font-extrabold tabular-nums ${
                todayBalance >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {todayBalance >= 0 ? "+" : ""}
              {fmtMin(todayBalance)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {fmtMin(todayWorked)} trabajado
              {todayExpected > 0 ? ` · ${fmtMin(todayExpected)} esperado` : ""}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vista semanal con navegación */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <Button asChild variant="ghost" size="icon">
              <Link href={`/fichajes?week=${prevWeek}` as never} aria-label="Semana anterior">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <CardTitle className="text-base capitalize">{weekRangeLabel}</CardTitle>
            <Button asChild variant="ghost" size="icon">
              <Link href={`/fichajes?week=${nextWeek}` as never} aria-label="Semana siguiente">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {weekBalance.map((d) => {
              const date = new Date(d.date + "T12:00:00");
              const isToday = d.date === todayStr;
              const ab = absenceFor(d.date);
              // Badge ⚠️ si trabajó >30% más de lo esperado
              const exceededLimit =
                d.expected_minutes > 0 &&
                d.worked_minutes > d.expected_minutes * 1.3;
              return (
                <li
                  key={d.date}
                  className={`flex items-center gap-3 py-2.5 ${isToday ? "bg-primary/5 -mx-2 px-2 rounded-lg" : ""}`}
                >
                  <div
                    className={`flex h-10 w-10 flex-col items-center justify-center rounded-xl text-sm font-bold ${
                      isToday
                        ? "bg-primary text-primary-foreground"
                        : ab
                          ? "bg-orange-100 text-orange-700"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <span className="text-base leading-none">{date.getDate()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold capitalize">
                      {date.toLocaleDateString("es-ES", { weekday: "long" })}
                      {ab && (
                        <Ghost className="h-3.5 w-3.5 text-orange-600" />
                      )}
                    </div>
                    {ab && (
                      <div className="mt-0.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-800">
                          {ab.label} · Día completo
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {exceededLimit ? (
                      <div className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-xs font-bold tabular-nums text-red-700">
                        <AlertTriangle className="h-3 w-3" />
                        {fmtMin(d.worked_minutes)}
                      </div>
                    ) : (
                      <div className="text-sm font-bold tabular-nums">
                        {fmtMin(d.worked_minutes)}
                      </div>
                    )}
                    {d.expected_minutes > 0 && (
                      <div className="text-[11px] tabular-nums text-muted-foreground">
                        / {fmtMin(d.expected_minutes)}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* KPIs del mes */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Trabajado (mes)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold tabular-nums">{fmtMin(totalWorked)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Esperado (mes)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold tabular-nums text-muted-foreground">
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
              className={`text-3xl font-extrabold tabular-nums ${
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
              className={`text-3xl font-extrabold tabular-nums ${
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
          <CardTitle>Mis ausencias</CardTitle>
        </CardHeader>
        <CardContent>
          {absencesAll.length === 0 ? (
            <p className="text-sm text-muted-foreground">No has solicitado ausencias.</p>
          ) : (
            <ul className="divide-y">
              {absencesAll.map((a) => (
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

      {myRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Mis solicitudes de fichaje</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {myRequests.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-semibold">
                      {r.punch_kind === "clock_in"
                        ? "Entrada"
                        : r.punch_kind === "clock_out"
                          ? "Salida"
                          : r.punch_kind === "break_start"
                            ? "Inicio descanso"
                            : "Fin descanso"}
                      {" · "}
                      {new Date(r.requested_at).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/Madrid",
                      })}
                    </div>
                    {r.reason && (
                      <div className="text-xs text-muted-foreground">{r.reason}</div>
                    )}
                  </div>
                  <Badge
                    variant={
                      r.status === "approved"
                        ? "success"
                        : r.status === "rejected"
                          ? "destructive"
                          : r.status === "cancelled"
                            ? "secondary"
                            : "warning"
                    }
                  >
                    {r.status === "approved"
                      ? "Aprobada"
                      : r.status === "rejected"
                        ? "Rechazada"
                        : r.status === "cancelled"
                          ? "Cancelada"
                          : "Pendiente"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
