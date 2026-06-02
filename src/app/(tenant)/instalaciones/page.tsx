import Link from "next/link";
import { listInstallations } from "@/modules/installations/actions";
import { listInstallers } from "@/modules/agenda/actions";
import { STATUS_LABEL, KIND_LABEL } from "@/modules/installations/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { Calendar, Eye, Phone, MessageSquare, MapPin, AlertTriangle, Home } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { requireModuleAccess } from "@/shared/lib/auth/module-guard";
import {
  InstallationSmartAlerts,
  getInstallationAlerts,
} from "@/modules/installations/smart-alerts";
import { InstallationSatisfactionRanking } from "@/modules/installations/satisfaction-ranking";
import { InstallationsCalendar } from "@/modules/installations/calendar-view";

export const dynamic = "force-dynamic";

const INST_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  unscheduled: "neutral",
  scheduled: "info",
  in_progress: "onhold",
  paused: "neutral",
  completed: "success",
  cancelled: "rejected",
  incident_pending: "rejected",
};

const STATUS_OPTIONS = [
  "scheduled",
  "in_progress",
  "paused",
  "incident_pending",
  "completed",
  "cancelled",
] as const;

const DAY_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Vercel corre en UTC. Para que el agrupado por día y la hora visible
// salgan en hora local española usamos siempre Europe/Madrid. Antes
// "10:00 local" se renderizaba como "08:00" porque toLocaleTimeString
// sin timeZone usa la del host (UTC).
const TZ = "Europe/Madrid";

function dateKey(iso: string): string {
  // YYYY-MM-DD en zona Madrid, robusto frente al UTC del server.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function todayKey(): string {
  return dateKey(new Date().toISOString());
}
function tomorrowKey(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return dateKey(t.toISOString());
}

function fmtDayHeader(iso: string): string {
  // `iso` aquí es YYYY-MM-DD (clave de día en zona Madrid). Para mostrar
  // el día de la semana correcto interpretamos la fecha al mediodía de
  // Madrid (evita off-by-one al cruzar medianoche UTC).
  const d = new Date(`${iso}T12:00:00+02:00`);
  const t = todayKey();
  if (iso === t)
    return `Hoy · ${d.toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: TZ })}`;
  if (iso === tomorrowKey())
    return `Mañana · ${d.toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: TZ })}`;
  const dayName = DAY_LABEL[
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        weekday: "long",
      })
        .formatToParts(d)
        .find((p) => p.type === "weekday")?.value
        ? // Mapeo manual de "Monday" → 1 etc.
          ({
            Sunday: 0,
            Monday: 1,
            Tuesday: 2,
            Wednesday: 3,
            Thursday: 4,
            Friday: 5,
            Saturday: 6,
          } as Record<string, number>)[
            new Intl.DateTimeFormat("en-US", {
              timeZone: TZ,
              weekday: "long",
            })
              .formatToParts(d)
              .find((p) => p.type === "weekday")!.value
          ] ?? 0
        : 0,
    )
  ];
  return `${dayName} ${d.toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: TZ })}`;
}

export default async function InstalacionesPage({
  searchParams,
}: {
  searchParams: Promise<{
    installer?: string;
    status?: string;
    view?: string;
    y?: string;
    m?: string;
  }>;
}) {
  // Comerciales/telemarketers no acceden a instalaciones — redirigimos
  // al dashboard si llegan por URL directa.
  const session = await requireSession();
  requireModuleAccess(session, [
    "company_admin",
    "technical_director",
    "installer",
  ]);

  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");

  const sp = await searchParams;
  const view = sp.view === "cal" ? "cal" : "list";
  const todayCal = new Date();
  const calYear = sp.y ? parseInt(sp.y, 10) : todayCal.getFullYear();
  const calMonth = sp.m ? parseInt(sp.m, 10) : todayCal.getMonth();
  const installerFilter = sp.installer || undefined;
  const statusFilter = STATUS_OPTIONS.includes(sp.status as never) ? sp.status : undefined;
  const [installations, team, alerts] = await Promise.all([
    listInstallations({ installer_user_id: installerFilter, status: statusFilter }),
    listInstallers().catch(() => []),
    isUpper ? getInstallationAlerts().catch(() => null) : Promise.resolve(null),
  ]);

  // Separar agendadas (con scheduled_at), sin agendar, y con incidencia.
  // «Con incidencia» incluye tanto las que tienen `status=incident_pending`
  // (bloqueadas) como las que mantienen status normal pero tienen alguna
  // incidencia abierta en BD (notificada sin desagendar).
  type I = (typeof installations)[number];
  const withIncident: I[] = [];
  const scheduled: I[] = [];
  const unscheduled: I[] = [];
  for (const i of installations) {
    if (i.status === "incident_pending" || i.has_open_incident) {
      withIncident.push(i);
    } else if (i.scheduled_at) {
      scheduled.push(i);
    } else {
      unscheduled.push(i);
    }
  }

  // Agrupar agendadas por día (clave en zona Madrid).
  const byDay = new Map<string, I[]>();
  for (const i of scheduled) {
    const k = dateKey(i.scheduled_at!);
    const arr = byDay.get(k) ?? [];
    arr.push(i);
    byDay.set(k, arr);
  }
  const sortedDays = Array.from(byDay.keys()).sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Instalaciones</h1>
          <p className="text-sm text-muted-foreground">
            {installations.length} totales · {scheduled.length} agendadas · {unscheduled.length} sin programar
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle Lista / Calendario (decisión 2026-05-20) */}
          <div className="inline-flex rounded-xl border-2 border-border bg-card p-0.5">
            <Link
              href={"/instalaciones" as never}
              className={`inline-flex h-9 items-center rounded-lg px-3 text-sm font-bold ${
                view === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              Lista
            </Link>
            <Link
              href={"/instalaciones?view=cal" as never}
              className={`inline-flex h-9 items-center rounded-lg px-3 text-sm font-bold ${
                view === "cal"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              Calendario
            </Link>
          </div>
          <Link
            href={"/api/export/installations" as never}
            prefetch={false}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            ⬇ Exportar CSV
          </Link>
        </div>
      </div>

      {/* Vista CALENDARIO mensual (decisión 2026-05-20) */}
      {view === "cal" && (
        <InstallationsCalendar
          year={calYear}
          month={calMonth}
          installations={installations.map((i) => ({
            id: i.id,
            reference_code: i.reference_code,
            status: i.status,
            scheduled_at: i.scheduled_at,
            installer_user_id: i.installer_user_id,
            installer_name:
              team.find((t) => t.user_id === i.installer_user_id)?.full_name ?? null,
            customer_name: i.customer_name,
          }))}
        />
      )}

      <form className={`flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 ${view === "cal" ? "hidden" : ""}`}>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Instalador</label>
          <select
            name="installer"
            defaultValue={installerFilter ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {team.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Estado</label>
          <select
            name="status"
            defaultValue={statusFilter ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(installerFilter || statusFilter) && (
          <Link href="/instalaciones" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      {isUpper && alerts && <InstallationSmartAlerts alerts={alerts} />}

      {isUpper && <InstallationSatisfactionRanking />}

      {/* KPIs cabecera instalaciones (decisión 2026-05-20) */}
      {isUpper && (() => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const completedThisMonth = installations.filter(
          (i) =>
            i.status === "completed" &&
            i.completed_at &&
            new Date(i.completed_at) >= monthStart,
        );
        // Duración media en minutos
        const durations = completedThisMonth
          .map((i) => (i as { duration_seconds?: number | null }).duration_seconds)
          .filter((d): d is number => typeof d === "number" && d > 0);
        const avgMin =
          durations.length > 0
            ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length / 60)
            : null;
        const next7 = installations.filter((i) => {
          if (!i.scheduled_at) return false;
          const t = new Date(i.scheduled_at).getTime();
          return t >= Date.now() && t <= Date.now() + 7 * 86400000;
        });
        const inProgress = installations.filter((i) => i.status === "in_progress");
        return (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Completadas mes</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums">{completedThisMonth.length}</div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Duración media</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums">
                {avgMin != null ? `${avgMin} min` : "—"}
              </div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Próximos 7 días</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums">{next7.length}</div>
            </div>
            <div className={`rounded-xl border p-4 ${inProgress.length > 0 ? "border-amber-300 bg-amber-50" : "bg-card"}`}>
              <div className="text-xs uppercase text-muted-foreground">En curso ahora</div>
              <div className={`mt-1 text-3xl font-extrabold tabular-nums ${inProgress.length > 0 ? "text-amber-700" : ""}`}>
                {inProgress.length}
              </div>
            </div>
          </div>
        );
      })()}

      {view === "list" && withIncident.length > 0 && (
        <Card className="border-2 border-red-300 bg-red-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-900">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Con incidencia abierta ({withIncident.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {withIncident.map((i) => {
                const isBlocked = i.status === "incident_pending";
                const subtitle = isBlocked
                  ? "Pendiente de reagendar"
                  : i.scheduled_at
                    ? `Programada ${new Date(i.scheduled_at).toLocaleString("es-ES", { timeZone: TZ })}`
                    : "Sin agendar";
                return (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-red-200 bg-white p-3"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/instalaciones/${i.id}` as never}
                        className="font-medium text-red-900 hover:underline"
                      >
                        {i.customer_name ?? "—"}
                      </Link>
                      <div className="text-xs text-red-800">
                        {i.reference_code ?? `#${i.id.slice(0, 8)}`} ·{" "}
                        {KIND_LABEL[i.kind] ?? i.kind} · {subtitle}
                      </div>
                    </div>
                    {isBlocked ? (
                      <span className="rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                        Bloqueada
                      </span>
                    ) : (
                      <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                        Avisada
                      </span>
                    )}
                    <InstallationRowActions inst={i} />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {view === "list" && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Calendario por día
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sortedDays.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna instalación agendada.</p>
          ) : (
            <div className="space-y-5">
              {sortedDays.map((day) => (
                <div key={day} className="space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-primary">
                      {fmtDayHeader(day)}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {byDay.get(day)!.length} instalación{byDay.get(day)!.length === 1 ? "" : "es"}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {byDay
                      .get(day)!
                      .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""))
                      .map((i) => {
                        const time = new Date(i.scheduled_at!).toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: TZ,
                        });
                        return (
                          <li
                            key={i.id}
                            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
                          >
                            <div className="font-mono text-xs font-bold text-primary tabular-nums w-12">
                              {time}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/instalaciones/${i.id}` as never}
                                  className="font-medium hover:underline"
                                >
                                  {i.customer_name ?? "—"}
                                </Link>
                                {i.alerts && i.alerts.length > 0 && (
                                  <span
                                    className="inline-flex h-5 items-center rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-800"
                                    title={i.alerts.join(" · ")}
                                  >
                                    ⚠ {i.alerts.length}
                                  </span>
                                )}
                                {i.plan_type === "rental" && (
                                  <Badge variant="secondary" className="gap-1 text-[10px]">
                                    <Home className="h-3 w-3" /> Alquiler
                                  </Badge>
                                )}
                                {i.plan_type === "renting" && (
                                  <Badge variant="outline" className="text-[10px]">
                                    Renting
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {i.reference_code ?? `#${i.id.slice(0, 8)}`} · {KIND_LABEL[i.kind] ?? i.kind}
                                {i.address_short && (
                                  <>
                                    {" · "}
                                    <span className="inline-flex items-center gap-1">
                                      <MapPin className="h-3 w-3" />
                                      {i.address_short}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            <StatusPill
                              label={STATUS_LABEL[i.status] ?? i.status}
                              tone={INST_TONE[i.status] ?? "info"}
                            />
                            <InstallationRowActions inst={i} />
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {view === "list" && unscheduled.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sin programar ({unscheduled.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {unscheduled.map((i) => {
                const nextPrefDate = (i.preferred_dates ?? []).find((d) => {
                  const dt = new Date(d);
                  return !isNaN(dt.getTime()) && dt > new Date();
                });
                return (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/instalaciones/${i.id}` as never}
                        className="font-medium hover:underline"
                      >
                        {i.customer_name ?? "—"}
                      </Link>
                      {i.alerts && i.alerts.length > 0 && (
                        <span
                          className="inline-flex h-5 items-center rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-800"
                          title={i.alerts.join(" · ")}
                        >
                          ⚠ {i.alerts.length}
                        </span>
                      )}
                      {i.plan_type === "rental" && (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <Home className="h-3 w-3" /> Alquiler
                        </Badge>
                      )}
                      {i.plan_type === "renting" && (
                        <Badge variant="outline" className="text-[10px]">
                          Renting
                        </Badge>
                      )}
                      {nextPrefDate && (
                        <Badge variant="warning" className="text-[10px]">
                          📅 Cliente prefiere{" "}
                          {new Date(nextPrefDate).toLocaleDateString("es-ES", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {i.reference_code ?? `#${i.id.slice(0, 8)}`} · {KIND_LABEL[i.kind] ?? i.kind}
                      {i.address_short && (
                        <>
                          {" · "}
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {i.address_short}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <StatusPill
                    label={STATUS_LABEL[i.status] ?? i.status}
                    tone={INST_TONE[i.status] ?? "info"}
                  />
                  <InstallationRowActions inst={i} />
                </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InstallationRowActions({
  inst,
}: {
  inst: Awaited<ReturnType<typeof listInstallations>>[number];
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const i = inst as any;
  const phone = i.customer_phone ?? null;
  const lat = i.address_lat ?? null;
  const lng = i.address_lng ?? null;
  const street = i.address_street ?? null;
  const city = i.address_city ?? null;
  const mapsUrl =
    lat != null && lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : city
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            [street, city, "España"].filter(Boolean).join(", "),
          )}`
        : null;
  const wa = phone
    ? `https://wa.me/${(phone.startsWith("+") ? phone.slice(1) : `34${phone.replace(/\D/g, "")}`).replace(/\D/g, "")}`
    : null;
  return (
    <div className="flex items-center gap-0.5">
      <Link
        href={`/instalaciones/${inst.id}` as never}
        title="Ver instalación"
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
      >
        <Eye className="h-4 w-4" />
      </Link>
      {phone && (
        <a
          href={`tel:${phone}`}
          title={`Llamar ${phone}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
        >
          <Phone className="h-4 w-4" />
        </a>
      )}
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener"
          title="WhatsApp"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-100 hover:text-emerald-600"
        >
          <MessageSquare className="h-4 w-4" />
        </a>
      )}
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener"
          title="Ver en Maps"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
        >
          <MapPin className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}
