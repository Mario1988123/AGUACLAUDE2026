import { CalendarCheck2, Phone, ShieldCheck } from "lucide-react";
import { getPublicJobView } from "@/modules/maintenance/public-confirmation-actions";
import { ConfirmationClient } from "@/modules/maintenance/confirmation-client";

export const dynamic = "force-dynamic";

export default async function PublicConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const view = await getPublicJobView(token);

  if (!view.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-50 to-white p-6">
        <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-lg">
          <h1 className="text-xl font-bold text-rose-700">
            Enlace no válido
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{view.error}</p>
          <p className="mt-6 text-xs text-muted-foreground">
            Si necesitas ayuda, llámanos directamente.
          </p>
        </div>
      </div>
    );
  }

  const { job } = view;
  const scheduledDate = new Date(job.scheduled_at);
  const dateLabel = scheduledDate.toLocaleDateString("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeLabel = scheduledDate.toLocaleTimeString("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
  });

  const isDayBefore =
    scheduledDate.getTime() - Date.now() < 36 * 3600_000 &&
    scheduledDate.getTime() - Date.now() > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white p-4">
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-border bg-white p-6 shadow-lg sm:p-8">
          <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            {job.company_name}
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight">
            Hola {job.customer_name.split(" ")[0]},
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {view.token.used
              ? "Esta cita ya está registrada. Si necesitas hacer un cambio, llámanos."
              : isDayBefore
                ? "Mañana pasamos a verte. ¿Sigue todo correcto?"
                : "Estamos preparando tu próxima visita de mantenimiento."}
          </p>

          <div className="my-6 rounded-2xl border-2 border-sky-200 bg-sky-50 p-5">
            <div className="flex items-center gap-2 text-sky-900">
              <CalendarCheck2 className="h-5 w-5" />
              <span className="text-sm font-bold uppercase tracking-wide">
                Fecha propuesta
              </span>
            </div>
            <p className="mt-2 text-lg font-bold capitalize text-sky-950">
              {dateLabel}
            </p>
            <p className="text-sm text-sky-900">a las {timeLabel}</p>
            {job.technician_name && (
              <p className="mt-2 text-xs text-sky-800">
                Técnico: <strong>{job.technician_name}</strong>
              </p>
            )}
            {job.customer_address && (
              <p className="mt-1 text-xs text-sky-800">
                📍 {job.customer_address}
              </p>
            )}
          </div>

          {view.token.used ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center text-sm text-emerald-900">
              ✓ Acción registrada: <strong>{view.token.used_action}</strong>
            </div>
          ) : (
            <ConfirmationClient
              token={token}
              isDayBefore={isDayBefore}
              initialAction={sp.action ?? null}
              scheduledAt={job.scheduled_at}
            />
          )}

          {job.company_phone && (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              <Phone className="mr-1 inline h-3 w-3" />
              ¿Prefieres hablarlo por teléfono?{" "}
              <a
                href={`tel:${job.company_phone}`}
                className="font-bold text-primary hover:underline"
              >
                {job.company_phone}
              </a>
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Este enlace es personal y caduca en 30 días.
        </p>
      </div>
    </div>
  );
}
