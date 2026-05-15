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

type Category = "all" | "fichajes" | "ausencias" | "ventas" | "operaciones" | "other";

/** Clasifica una notificación por categoría según su kind. */
function categoryOf(kind: string): Category {
  if (kind.startsWith("time_tracking") || kind.startsWith("punch_request")) {
    return "fichajes";
  }
  if (kind.startsWith("absence")) return "ausencias";
  if (
    kind.startsWith("lead") ||
    kind.startsWith("proposal") ||
    kind.startsWith("contract") ||
    kind.startsWith("free_trial")
  ) {
    return "ventas";
  }
  if (
    kind.startsWith("installation") ||
    kind.startsWith("maintenance") ||
    kind.startsWith("incident") ||
    kind.startsWith("warehouse")
  ) {
    return "operaciones";
  }
  return "other";
}

const CAT_LABEL: Record<Exclude<Category, "all">, string> = {
  fichajes: "Fichajes",
  ausencias: "Ausencias",
  ventas: "Ventas",
  operaciones: "Operaciones",
  other: "Otras",
};

export default async function NotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; cat?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.filter === "unread" ? "unread" : "all";
  const cat = (sp.cat as Category | undefined) ?? "all";
  const all = await listMyNotifications();

  // Contar por categoría (sobre la lista total, no filtrada por sin-leer)
  const catCount: Record<Category, number> = {
    all: all.length,
    fichajes: 0,
    ausencias: 0,
    ventas: 0,
    operaciones: 0,
    other: 0,
  };
  const catUnread: Record<Category, number> = {
    all: 0,
    fichajes: 0,
    ausencias: 0,
    ventas: 0,
    operaciones: 0,
    other: 0,
  };
  for (const n of all) {
    const c = categoryOf(n.kind);
    catCount[c]++;
    if (!n.read_at) {
      catUnread[c]++;
      catUnread.all++;
    }
  }

  // Filtrar
  let items = all;
  if (cat !== "all") items = items.filter((n) => categoryOf(n.kind) === cat);
  if (filter === "unread") items = items.filter((n) => !n.read_at);

  const tabs: Category[] = ["all", "fichajes", "ausencias", "ventas", "operaciones", "other"];

  function hrefFor(c: Category, f: "all" | "unread"): string {
    const params = new URLSearchParams();
    if (c !== "all") params.set("cat", c);
    if (f === "unread") params.set("filter", "unread");
    const qs = params.toString();
    return qs ? `/notificaciones?${qs}` : "/notificaciones";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-sm text-muted-foreground">
            {catUnread.all} sin leer · {all.length} total
          </p>
        </div>
        {catUnread.all > 0 && <MarkAllReadButton />}
      </div>

      {/* Tabs categoría */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((c) => {
          const label = c === "all" ? "Todas" : CAT_LABEL[c];
          const count = c === "all" ? all.length : catCount[c];
          const unread = c === "all" ? catUnread.all : catUnread[c];
          if (c !== "all" && count === 0) return null;
          return (
            <Link
              key={c}
              href={hrefFor(c, filter) as never}
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border-2 px-3 text-xs font-bold ${
                cat === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              {label}
              {unread > 0 && (
                <span
                  className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    cat === c ? "bg-white text-primary" : "bg-red-500 text-white"
                  }`}
                >
                  {unread}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Filtro sin leer */}
      <div className="flex gap-2">
        <Link
          href={hrefFor(cat, "all") as never}
          className={`inline-flex h-9 items-center rounded-xl border px-3 text-xs font-semibold ${
            filter === "all"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          Todas
        </Link>
        <Link
          href={hrefFor(cat, "unread") as never}
          className={`inline-flex h-9 items-center rounded-xl border px-3 text-xs font-semibold ${
            filter === "unread"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          Sin leer ({cat === "all" ? catUnread.all : catUnread[cat]})
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {cat === "all" ? "Centro" : CAT_LABEL[cat]} ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter === "unread"
                ? "No tienes notificaciones sin leer."
                : "No tienes notificaciones."}
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
