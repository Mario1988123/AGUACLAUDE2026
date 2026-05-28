/**
 * Clasifica un `kind` de notificación en su categoría por defecto:
 * - "alert"  → accionable / urgente (bell del header)
 * - "event"  → informativo (solo /notificaciones, pestaña Eventos)
 *
 * Regla mental: si el usuario tiene que HACER algo o ENTERARSE para reaccionar
 * → alert. Si solo le notifica que algo se ha producido (hito) → event.
 *
 * Se puede sobreescribir pasando `category` explícito en `NotifyInput`.
 */
export function categoryOfKind(kind: string): "alert" | "event" {
  // Patrones por prefijo (catch-all)
  if (
    kind.startsWith("time_tracking.") ||
    kind.startsWith("punch_request.") ||
    kind.startsWith("absence.") ||
    kind.startsWith("incident.")
  ) {
    // Incidencias y solicitudes de RRHH son siempre accionables.
    // Excepción: incident.resolved es solo informativo
    if (kind === "incident.resolved") return "event";
    return "alert";
  }

  if (kind.startsWith("gocardless.")) {
    // Todos los avisos GoCardless requieren intervención admin
    return "alert";
  }

  // Lista explícita de alertas accionables
  const ALERTS = new Set([
    // Instalaciones — acciones requeridas
    "installation.assigned",
    "installation.tomorrow",
    "installation.stock_shortage",
    "installation.geo_off_road",
    "installation.start_far_from_address",
    "installation.started_far",
    "installation.late_completion",
    "installation.incident",
    "installation.forgotten",
    // Mantenimientos — acciones requeridas
    "maintenance.tomorrow",
    "maintenance.customer_postponed",
    // Wallet — validación pendiente
    "wallet.pending_validation",
    // Agenda — tareas asignadas/movidas
    "agenda.assigned",
    "agenda.reassigned",
    "agenda.rescheduled",
    "agenda.conflict_warning",
    // Contratos — reasignaciones (te dan trabajo)
    "contract.reassigned",
    // Leads — caducados (hay que reasignar)
    "lead.expired",
    "lead.unassigned_by_expiry",
    // Stock — bajo (hay que reponer)
    "stock.low",
    // Verifactu — facturas rechazadas (hay que reintentar)
    "verifactu.failed",
    // Cobros — acciones legales (decidir)
    "invoice.legal_action_suggested",
    "invoice.reminder_3_sent",
    // Pruebas gratuitas caducadas (decidir)
    "free_trial.expired",
    // Google Maps — presupuesto desbordado
    "gmaps.budget_alert",
    // Almacenes — sugerencia de compra
    "warehouse.purchase_suggestion",
  ]);

  if (ALERTS.has(kind)) return "alert";

  // Lista explícita de eventos informativos (default seguro)
  // Por defecto, cualquier kind desconocido o no listado → event
  // (es menos intrusivo: peor que algo importante caiga en eventos
  //  a que un evento informativo "ensucie" la campana del header)
  return "event";
}
