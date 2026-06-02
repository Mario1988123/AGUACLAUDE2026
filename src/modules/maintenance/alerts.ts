/**
 * Avisos operativos de un mantenimiento — función pura compartida entre
 * el listado (badge ⚠ N) y la ficha (modal auto-abrir).
 *
 * Vive en su propio archivo (no en `actions.ts`) porque ese archivo
 * lleva la directiva `"use server"`, que prohíbe exportar funciones no
 * async. Aquí es síncrona porque solo lee del input.
 *
 * Defensivo: no asume columnas opcionales (customer_called_at, etc.);
 * si el caller no las pasa, simplemente no añade ese aviso.
 */
export function computeMaintenanceJobAlerts(job: {
  status: string;
  scheduled_at: string | null;
  started_at?: string | null;
  technician_user_id: string | null;
  customer_called_at?: string | null;
  confirmed_at?: string | null;
}): string[] {
  const alerts: string[] = [];
  const now = Date.now();
  const fourHoursMs = 4 * 3600_000;
  const thirtyDaysMs = 30 * 86400_000;

  if (job.status === "scheduled" && job.scheduled_at) {
    const ts = new Date(job.scheduled_at).getTime();
    if (!isNaN(ts) && ts < now) {
      alerts.push("Retrasado: fecha programada en el pasado");
    }
  }

  if (job.status === "in_progress" && job.started_at) {
    const ts = new Date(job.started_at).getTime();
    if (!isNaN(ts) && now - ts > fourHoursMs) {
      alerts.push("En curso más de 4 horas sin cerrar");
    }
  }

  if (
    (job.status === "scheduled" || job.status === "preprogrammed") &&
    !job.technician_user_id
  ) {
    alerts.push("Sin técnico asignado");
  }

  if (job.status === "needs_callback") {
    alerts.push("Pendiente devolver llamada al cliente");
  }

  if (
    job.status === "preprogrammed" &&
    job.scheduled_at &&
    !job.customer_called_at &&
    !job.confirmed_at
  ) {
    const ts = new Date(job.scheduled_at).getTime();
    if (!isNaN(ts) && ts - now < thirtyDaysMs) {
      alerts.push("Propuesta sin confirmar con el cliente");
    }
  }

  return alerts;
}
