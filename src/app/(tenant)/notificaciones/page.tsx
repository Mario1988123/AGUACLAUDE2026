import { listMyNotifications } from "@/modules/notifications/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { MarkAllReadButton } from "@/modules/notifications/mark-all-button";

const SEV_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> =
  {
    info: "default",
    success: "success",
    warning: "warning",
    error: "destructive",
  };

export default async function NotificacionesPage() {
  const items = await listMyNotifications();
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-sm text-muted-foreground">{unread} sin leer</p>
        </div>
        {unread > 0 && <MarkAllReadButton />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Centro</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tienes notificaciones.</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 py-3 ${!n.read_at ? "bg-primary/5 -mx-6 px-6" : ""}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
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
                  {n.action_url && (
                    <a
                      href={n.action_url}
                      className="text-xs text-primary hover:underline"
                    >
                      Ir
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
