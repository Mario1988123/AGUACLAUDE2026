import Link from "next/link";
import {
  Wrench,
  ShieldCheck,
  Calendar,
  MapPin,
  Clock,
  ArrowRight,
  Phone,
  MessageCircle,
} from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { isModuleActive } from "@/shared/lib/auth/module-guard";
import { getMyDayItems, getMyDayItemsOptimized } from "@/modules/my-day/actions";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { PhoneCall } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { RoutePlannerButton } from "@/modules/routes/route-planner-button";
import {
  AddressesClusterMap,
  type MapPoint,
} from "@/shared/components/addresses-cluster-map";

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

export default async function MiDiaPage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  // Ordenamiento óptimo (decisión 2026-05-20): por defecto orden cronológico;
  // ?orden=ruta calcula TSP greedy desde la casa del usuario. La opción
  // se gatea por el módulo `routes`: si la empresa no lo tiene activo,
  // /mi-dia muestra solo la lista cronológica sin botón "ordenar".
  const routesModuleOn = await isModuleActive("routes");
  const optimized =
    routesModuleOn && sp.orden === "ruta"
      ? await getMyDayItemsOptimized().catch(() => null)
      : null;
  const items =
    optimized?.items ?? (await getMyDayItems().catch(() => []));
  const totalKm = optimized?.total_km ?? null;
  const isOptimized = optimized?.ordered ?? false;

  const today = new Date();
  const dateLabel = today.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Banner para admin/TMK: cuántos mantenimientos por confirmar tienen
  // pendientes para los próximos 30 días. Solo para roles con permiso.
  const canConfirmMaintenance =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  let pendingConfirmCount = 0;
  if (canConfirmMaintenance && session.company_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const next30 = new Date();
      next30.setDate(next30.getDate() + 30);
      const { count } = await admin
        .from("maintenance_jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", session.company_id)
        .eq("status", "preprogrammed")
        .is("confirmed_at", null)
        .lte("scheduled_at", next30.toISOString());
      pendingConfirmCount = count ?? 0;
    } catch {
      /* migración aún no aplicada — banner oculto */
    }
  }

  return (
    <div className="space-y-6">
      {pendingConfirmCount > 0 && (
        <Link
          href={"/mantenimientos/por-confirmar" as never}
          className="flex items-center justify-between gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 hover:bg-amber-100"
        >
          <div className="flex items-center gap-3">
            <PhoneCall className="h-5 w-5 text-amber-700" />
            <div>
              <div className="font-bold text-amber-900">
                {pendingConfirmCount} mantenimiento
                {pendingConfirmCount === 1 ? "" : "s"} por confirmar
              </div>
              <p className="text-xs text-amber-800">
                Llama a los clientes para fijar fecha. Próximos 30 días.
              </p>
            </div>
          </div>
          <span className="rounded-md bg-amber-200 px-2 py-1 text-xs font-bold text-amber-900">
            Abrir cola →
          </span>
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Mi día</h1>
          <p className="mt-1 text-sm text-muted-foreground capitalize">
            {dateLabel} · Hola {session.full_name ?? session.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {routesModuleOn && items.length > 1 && (
            <>
              <Link
                href={sp.orden === "ruta" ? "/mi-dia" : "/mi-dia?orden=ruta"}
                className={`inline-flex h-10 items-center gap-2 rounded-xl border-2 px-3 text-sm font-bold ${
                  isOptimized
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted"
                }`}
              >
                <MapPin className="h-4 w-4" />
                {isOptimized ? "Orden por ruta" : "Ordenar por ruta"}
              </Link>
              {isOptimized && totalKm != null && totalKm > 0 && (
                <span className="rounded-xl bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  {totalKm} km totales
                </span>
              )}
              {(() => {
                // Deep link a Google Maps con todas las paradas del día.
                // Formato: origin = primera parada, destination = última,
                // waypoints = intermedias separadas por '|'.
                const geoItems = items.filter(
                  (it) =>
                    it.geo_latitude != null && it.geo_longitude != null,
                );
                if (geoItems.length < 2) return null;
                const first = geoItems[0]!;
                const last = geoItems[geoItems.length - 1]!;
                const middle = geoItems.slice(1, -1);
                const url = new URL("https://www.google.com/maps/dir/");
                url.searchParams.set("api", "1");
                url.searchParams.set(
                  "origin",
                  `${first.geo_latitude},${first.geo_longitude}`,
                );
                url.searchParams.set(
                  "destination",
                  `${last.geo_latitude},${last.geo_longitude}`,
                );
                if (middle.length > 0) {
                  url.searchParams.set(
                    "waypoints",
                    middle
                      .map((m) => `${m.geo_latitude},${m.geo_longitude}`)
                      .join("|"),
                  );
                }
                url.searchParams.set("travelmode", "driving");
                return (
                  <a
                    href={url.toString()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-xl border-2 border-emerald-500 bg-emerald-500 px-3 text-sm font-bold text-white hover:bg-emerald-600"
                  >
                    <MapPin className="h-4 w-4" />
                    Navegar en Google Maps
                  </a>
                );
              })()}
              <RoutePlannerButton />
            </>
          )}
        </div>
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
        <>
          {/* Mapa con todas las paradas del día geolocalizadas. Solo se
              muestra si hay al menos un punto con coords; si ninguna
              tarea las tiene, el componente devuelve null. */}
          <AddressesClusterMap
            points={items
              .filter(
                (it) =>
                  it.geo_latitude != null && it.geo_longitude != null,
              )
              .map<MapPoint>((it) => ({
                id: `${it.kind}-${it.id}`,
                lat: it.geo_latitude as number,
                lng: it.geo_longitude as number,
                kind: it.kind,
                title: it.title,
                subtitle:
                  it.subtitle ?? it.address_summary ?? null,
                href: it.href,
              }))}
            height={320}
          />
        </>
      )}
      {items.length > 0 && (
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
                        {it.address_summary && (
                          <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {it.address_summary}
                          </div>
                        )}
                        {it.customer_phone && (
                          <div className="mt-2 flex gap-1.5">
                            <a
                              href={`tel:${it.customer_phone}`}
                              className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-100 px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-200"
                            >
                              <Phone className="h-3 w-3" />
                              Llamar
                            </a>
                            <a
                              href={`https://wa.me/${it.customer_phone.replace(/[^0-9+]/g, "")}`}
                              target="_blank"
                              rel="noopener"
                              className="inline-flex h-8 items-center gap-1 rounded-md bg-[#25D366] px-2 text-xs font-semibold text-white hover:opacity-90"
                            >
                              <MessageCircle className="h-3 w-3" />
                              WhatsApp
                            </a>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col shrink-0 gap-1.5">
                        <Link
                          href={it.href as never}
                          className="flex h-12 items-center justify-center gap-1 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground hover:opacity-90"
                          aria-label={
                            it.kind === "installation"
                              ? "Abrir parte de instalación"
                              : it.kind === "maintenance"
                                ? "Abrir mantenimiento"
                                : "Abrir tarea"
                          }
                        >
                          {it.kind === "installation"
                            ? "Iniciar parte"
                            : it.kind === "maintenance"
                              ? "Abrir"
                              : "Ver"}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                        {mapsUrl && (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener"
                            className="flex h-9 items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 text-xs font-bold hover:bg-muted"
                            aria-label="Abrir ruta en Google Maps"
                          >
                            <MapPin className="h-4 w-4" />
                            Ruta
                          </a>
                        )}
                      </div>
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
