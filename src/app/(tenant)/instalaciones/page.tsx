import Link from "next/link";
import { listInstallations } from "@/modules/installations/actions";
import { listInstallers } from "@/modules/agenda/actions";
import { STATUS_LABEL, KIND_LABEL } from "@/modules/installations/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { Calendar, Eye, Phone, MessageSquare, MapPin } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { requireModuleAccess } from "@/shared/lib/auth/module-guard";

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
};

const STATUS_OPTIONS = [
  "scheduled",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
] as const;

const DAY_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDayHeader(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  const t = dateKey(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (iso === t) return `Hoy · ${d.toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`;
  if (iso === dateKey(tomorrow)) return `Mañana · ${d.toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`;
  return `${DAY_LABEL[d.getDay()]} ${d.toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`;
}

export default async function InstalacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ installer?: string; status?: string }>;
}) {
  // Comerciales/telemarketers no acceden a instalaciones — redirigimos
  // al dashboard si llegan por URL directa.
  const session = await requireSession();
  requireModuleAccess(session, [
    "company_admin",
    "technical_director",
    "installer",
  ]);

  const sp = await searchParams;
  const installerFilter = sp.installer || undefined;
  const statusFilter = STATUS_OPTIONS.includes(sp.status as never) ? sp.status : undefined;
  const [installations, team] = await Promise.all([
    listInstallations({ installer_user_id: installerFilter, status: statusFilter }),
    listInstallers().catch(() => []),
  ]);

  // Separar agendadas (con scheduled_at) y sin agendar
  type I = (typeof installations)[number];
  const scheduled: I[] = [];
  const unscheduled: I[] = [];
  for (const i of installations) {
    if (i.scheduled_at) scheduled.push(i);
    else unscheduled.push(i);
  }

  // Agrupar agendadas por día
  const byDay = new Map<string, I[]>();
  for (const i of scheduled) {
    const k = dateKey(new Date(i.scheduled_at!));
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
        <Link
          href={"/api/export/installations" as never}
          prefetch={false}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          ⬇ Exportar CSV
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
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
                              <Link
                                href={`/instalaciones/${i.id}` as never}
                                className="font-medium hover:underline"
                              >
                                {i.customer_name ?? "—"}
                              </Link>
                              <div className="text-xs text-muted-foreground">
                                {i.reference_code ?? `#${i.id.slice(0, 8)}`} · {KIND_LABEL[i.kind] ?? i.kind}
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

      {unscheduled.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sin programar ({unscheduled.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {unscheduled.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/instalaciones/${i.id}` as never}
                      className="font-medium hover:underline"
                    >
                      {i.customer_name ?? "—"}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {i.reference_code ?? `#${i.id.slice(0, 8)}`} · {KIND_LABEL[i.kind] ?? i.kind}
                    </div>
                  </div>
                  <StatusPill
                    label={STATUS_LABEL[i.status] ?? i.status}
                    tone={INST_TONE[i.status] ?? "info"}
                  />
                  <InstallationRowActions inst={i} />
                </li>
              ))}
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
