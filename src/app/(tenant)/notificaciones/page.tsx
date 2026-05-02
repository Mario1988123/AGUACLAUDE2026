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

export default async function NotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.filter === "unread" ? "unread" : "all";
  const all = await listMyNotifications();
  const items = filter === "unread" ? all.filter((n) => !n.read_at) : all;
  const unread = all.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-sm text-muted-foreground">
            {unread} sin leer · {all.length} total
          </p>
        </div>
        {unread > 0 && <MarkAllReadButton />}
      </div>

      <div className="flex gap-2">
        <Link
          href={"/notificaciones" as never}
          className={`inline-flex h-10 items-center rounded-xl border-2 px-4 text-sm font-semibold ${
            filter === "all"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          Todas
        </Link>
        <Link
          href={"/notificaciones?filter=unread" as never}
          className={`inline-flex h-10 items-center rounded-xl border-2 px-4 text-sm font-semibold ${
            filter === "unread"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          Sin leer ({unread})
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Centro</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter === "unread" ? "No tienes notificaciones sin leer." : "No tienes notificaciones."}
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
                      <Badge variant={SEV_VARIANT[n.severity]}>{n.severity}</Badge>
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
