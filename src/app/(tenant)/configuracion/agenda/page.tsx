import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Calendar, Clock, MapPin } from "lucide-react";
import { getCompanySettings } from "@/modules/config/company/actions";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

const DAYS_LABEL: Record<string, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};

export default async function ConfiguracionAgendaPage() {
  const settings = await getCompanySettings().catch(() => null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Configuración · Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Las horas comerciales, tolerancias y avisos que afectan a las visitas e instalaciones
            se editan en la configuración general de la empresa.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Horario comercial actual
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!settings ? (
            <p className="text-sm text-muted-foreground">
              No se pudo cargar la configuración. ¿Eres administrador?
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(DAYS_LABEL).map(([k, label]) => {
                const h = settings.business_hours[k];
                return (
                  <li
                    key={k}
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-3"
                  >
                    <span className="text-sm font-semibold">{label}</span>
                    {h ? (
                      <span className="text-xs tabular-nums text-primary">
                        {h.open} – {h.close}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Cerrado</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            href="/configuracion"
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            Editar horarios →
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Tolerancias instalación
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {settings && (
            <>
              <div>
                <strong>Distancia geo:</strong>{" "}
                {settings.installation_geo_tolerance_m} m
                <span className="ml-2 text-xs text-muted-foreground">
                  (si el técnico está más lejos al iniciar, se genera incidencia)
                </span>
              </div>
              <div>
                <strong>Margen tiempo:</strong>{" "}
                {settings.installation_time_tolerance_min} min
                <span className="ml-2 text-xs text-muted-foreground">
                  (margen ± respecto a la hora agendada)
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Tipos de evento disponibles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              { k: "visit", l: "Visita comercial" },
              { k: "call", l: "Llamada programada" },
              { k: "manual", l: "Tarea manual" },
              { k: "meeting", l: "Reunión interna" },
              { k: "reminder", l: "Recordatorio" },
              { k: "installation", l: "Instalación (auto)" },
              { k: "maintenance", l: "Mantenimiento (auto)" },
              { k: "incident_followup", l: "Seguimiento incidencia (auto)" },
            ].map((t) => (
              <li
                key={t.k}
                className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm"
              >
                <code className="rounded bg-muted px-2 py-0.5 text-xs">{t.k}</code>
                <span>{t.l}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Los tipos son fijos (enum BD). Los marcados como (auto) se generan automáticamente
            por el sistema (no se pueden crear manualmente desde Agenda).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
