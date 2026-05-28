import Link from "next/link";
import { listMyNotifications } from "@/modules/notifications/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { MarkAllReadButton } from "@/modules/notifications/mark-all-button";
import { MarkReadButton } from "@/modules/notifications/mark-read-button";

export const dynamic = "force-dynamic";

const SEV_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> =
  {
    info: "default",
    success: "success",
    warning: "warning",
    error: "destructive",
  };

const SEV_LABEL: Record<string, string> = {
  info: "Info",
  success: "OK",
  warning: "Aviso",
  error: "Error",
};

type Category = "alert" | "event";
type Tab = Category | "all";

/**
 * Sub-categorías dentro de la pestaña Eventos para no perder el filtro
 * fino que ya existía (Ventas, Operaciones, etc.). En la pestaña Alertas
 * no hace falta: el listado ya es corto y todas son accionables.
 */
type EventGroup = "all" | "ventas" | "operaciones" | "fichajes" | "cobros" | "other";

function eventGroupOf(kind: string): Exclude<EventGroup, "all"> {
  if (
    kind.startsWith("lead.") ||
    kind.startsWith("proposal") ||
    kind.startsWith("contract") ||
    kind.startsWith("customer") ||
    kind.startsWith("free_trial")
  ) {
    return "ventas";
  }
  if (
    kind.startsWith("installation") ||
    kind.startsWith("maintenance") ||
    kind.startsWith("warehouse") ||
    kind.startsWith("loading") ||
    kind === "stock.low"
  ) {
    return "operaciones";
  }
  if (kind.startsWith("time_tracking") || kind.startsWith("punch_request") || kind.startsWith("absence")) {
    return "fichajes";
  }
  if (kind.startsWith("invoice") || kind.startsWith("wallet") || kind.startsWith("gocardless") || kind.startsWith("verifactu")) {
    return "cobros";
  }
  return "other";
}

const EVENT_GROUP_LABEL: Record<Exclude<EventGroup, "all">, string> = {
  ventas: "Ventas",
  operaciones: "Operaciones",
  fichajes: "Personal",
  cobros: "Cobros",
  other: "Otras",
};

export default async function NotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; filter?: string; group?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "event" ? "event" : sp.tab === "all" ? "all" : "alert";
  const filter = sp.filter === "unread" ? "unread" : "all";
  const group: EventGroup = ((["all", "ventas", "operaciones", "fichajes", "cobros", "other"] as const).includes(
    sp.group as EventGroup,
  )
    ? (sp.group as EventGroup)
    : "all") as EventGroup;

  const all = await listMyNotifications();

  // Contadores
  let alertTotal = 0;
  let alertUnread = 0;
  let eventTotal = 0;
  let eventUnread = 0;
  const eventGroupCount: Record<EventGroup, number> = {
    all: 0,
    ventas: 0,
    operaciones: 0,
    fichajes: 0,
    cobros: 0,
    other: 0,
  };
  const eventGroupUnread: Record<EventGroup, number> = {
    all: 0,
    ventas: 0,
    operaciones: 0,
    fichajes: 0,
    cobros: 0,
    other: 0,
  };

  for (const n of all) {
    if (n.category === "alert") {
      alertTotal++;
      if (!n.read_at) alertUnread++;
    } else {
      eventTotal++;
      eventGroupCount.all++;
      const g = eventGroupOf(n.kind);
      eventGroupCount[g]++;
      if (!n.read_at) {
        eventUnread++;
        eventGroupUnread.all++;
        eventGroupUnread[g]++;
      }
    }
  }

  // Filtrado
  let items = all;
  if (tab === "alert") {
    items = items.filter((n) => n.category === "alert");
  } else if (tab === "event") {
    items = items.filter((n) => n.category === "event");
    if (group !== "all") items = items.filter((n) => eventGroupOf(n.kind) === group);
  }
  if (filter === "unread") items = items.filter((n) => !n.read_at);

  function hrefFor(t: Tab, f: "all" | "unread", g: EventGroup = "all"): string {
    const params = new URLSearchParams();
    if (t !== "alert") params.set("tab", t);
    if (f === "unread") params.set("filter", "unread");
    if (t === "event" && g !== "all") params.set("group", g);
    const qs = params.toString();
    return qs ? `/notificaciones?${qs}` : "/notificaciones";
  }

  const headerUnread = tab === "alert" ? alertUnread : tab === "event" ? eventUnread : alertUnread + eventUnread;
  const headerTotal = tab === "alert" ? alertTotal : tab === "event" ? eventTotal : alertTotal + eventTotal;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-sm text-muted-foreground">
            {headerUnread} sin leer · {headerTotal} total
          </p>
        </div>
        {headerUnread > 0 && (
          <MarkAllReadButton category={tab === "all" ? undefined : (tab as "alert" | "event")} />
        )}
      </div>

      {/* Tabs principales: Alertas / Eventos */}
      <div className="flex flex-wrap gap-2 border-b">
        {(["alert", "event"] as const).map((t) => {
          const active = tab === t;
          const total = t === "alert" ? alertTotal : eventTotal;
          const unread = t === "alert" ? alertUnread : eventUnread;
          const label = t === "alert" ? "🚨 Alertas" : "📰 Eventos";
          const hint = t === "alert" ? "Requieren acción" : "Informativos";
          return (
            <Link
              key={t}
              href={hrefFor(t, filter) as never}
              className={`inline-flex flex-col gap-0.5 px-4 py-2 -mb-px border-b-2 ${
                active
                  ? "border-primary text-primary font-bold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-2 text-sm">
                {label}
                {unread > 0 && (
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                      t === "alert" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {unread}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">({total})</span>
              </span>
              <span className="text-[10px] text-muted-foreground">{hint}</span>
            </Link>
          );
        })}
      </div>

      {/* Sub-tabs solo en pestaña Eventos */}
      {tab === "event" && (
        <div className="flex flex-wrap gap-2">
          {(["all", "ventas", "operaciones", "fichajes", "cobros", "other"] as const).map((g) => {
            const total = eventGroupCount[g];
            if (g !== "all" && total === 0) return null;
            const unread = eventGroupUnread[g];
            const label = g === "all" ? "Todos" : EVENT_GROUP_LABEL[g];
            const active = group === g;
            return (
              <Link
                key={g}
                href={hrefFor("event", filter, g) as never}
                className={`inline-flex h-8 items-center gap-1.5 rounded-xl border-2 px-3 text-xs font-bold ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted"
                }`}
              >
                {label}
                {unread > 0 && (
                  <span
                    className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                      active ? "bg-white text-primary" : "bg-red-500 text-white"
                    }`}
                  >
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Filtro sin leer */}
      <div className="flex gap-2">
        <Link
          href={hrefFor(tab, "all", group) as never}
          className={`inline-flex h-9 items-center rounded-xl border px-3 text-xs font-semibold ${
            filter === "all"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          Todas
        </Link>
        <Link
          href={hrefFor(tab, "unread", group) as never}
          className={`inline-flex h-9 items-center rounded-xl border px-3 text-xs font-semibold ${
            filter === "unread"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          Sin leer ({headerUnread})
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {tab === "alert" ? "Alertas accionables" : "Eventos informativos"} ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter === "unread"
                ? tab === "alert"
                  ? "No tienes alertas sin atender. 🎉"
                  : "No tienes eventos sin leer."
                : tab === "alert"
                  ? "No tienes alertas. Todo en orden."
                  : "No tienes eventos."}
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 py-3 ${!n.read_at ? "bg-primary/5 -mx-6 px-6" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm ${!n.read_at ? "font-semibold" : ""}`}>
                        {n.category === "alert" && "🚨 "}
                        {n.title}
                      </span>
                      <Badge variant={SEV_VARIANT[n.severity]}>
                        {SEV_LABEL[n.severity] ?? n.severity}
                      </Badge>
                    </div>
                    {n.body && <p className="mt-1 text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString("es-ES")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {n.action_url && (
                      <Link
                        href={n.action_url as never}
                        className="text-xs text-primary hover:underline"
                      >
                        Ir
                      </Link>
                    )}
                    {!n.read_at && <MarkReadButton id={n.id} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
