import Link from "next/link";
import { Wrench, ShieldCheck, Calendar, MapPin, Clock } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { getMyDayItems } from "@/modules/my-day/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

const KIND_ICON = {
  installation: Wrench,
  maintenance: ShieldCheck,
  agenda: Calendar,
} as const;
const KIND_LABEL: Record<string, string> = {
  installation: "Instalación",
  maintenance: "Mantenimiento",
  agenda: "Agenda",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  scheduled: "default",
  in_progress: "warning",
  paused: "outline",
  completed: "success",
  cancelled: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Programado",
  in_progress: "En curso",
  paused: "En pausa",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No presentado",
  rescheduled: "Reprogramado",
  open: "Abierta",
  assigned: "Asignada",
  resolved: "Resuelta",
  closed: "Cerrada",
};

export default async function MiDiaPage() {
  const session = await requireSession();
  const items = await getMyDayItems().catch(() => []);

  const today = new Date();
  const dateLabel = today.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Mi día</h1>
        <p className="mt-1 text-sm text-muted-foreground capitalize">
          {dateLabel} · Hola {session.full_name ?? session.email}
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No tienes nada programado para hoy. ¡Buen día!
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Programado para hoy ({items.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {items.map((it) => {
                const Icon = KIND_ICON[it.kind];
                const time = new Date(it.scheduled_at).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const mapsUrl =
                  it.geo_latitude != null && it.geo_longitude != null
                    ? `https://www.google.com/maps/dir/?api=1&destination=${it.geo_latitude},${it.geo_longitude}`
                    : null;
                return (
                  <li
                    key={`${it.kind}-${it.id}`}
                    className="rounded-2xl border-2 border-border bg-card p-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                        <span className="mt-1 text-[10px] font-bold uppercase">
                          {KIND_LABEL[it.kind]}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="h-4 w-4 text-primary" />
                          <span className="text-base font-bold tabular-nums">{time}</span>
                          <Badge variant={STATUS_VARIANT[it.status] ?? "default"}>
                            {STATUS_LABEL[it.status] ?? it.status}
                          </Badge>
                        </div>
                        <Link
                          href={it.href as never}
                          className="text-base font-semibold hover:underline"
                        >
                          {it.title}
                        </Link>
                        {it.subtitle && (
                          <div className="text-xs text-muted-foreground">{it.subtitle}</div>
                        )}
                      </div>
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener"
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:opacity-90"
                          aria-label="Abrir ruta en Google Maps"
                        >
                          <MapPin className="h-5 w-5" />
                        </a>
                      )}
                    </div>
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
