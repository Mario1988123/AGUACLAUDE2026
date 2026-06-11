export const KIND_LABEL: Record<string, string> = {
  visit: "Visita",
  installation: "Instalación",
  uninstall: "Desinstalación",
  maintenance: "Mantenimiento",
  call: "Llamada",
  reminder: "Recordatorio",
  manual: "Tarea",
  incident_followup: "Seg. incidencia",
  meeting: "Reunión",
};

export const STATUS_LABEL: Record<string, string> = {
  scheduled: "Programado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No presentación",
  rescheduled: "Reprogramado",
};

export const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  scheduled: "default",
  in_progress: "warning",
  completed: "success",
  cancelled: "destructive",
  no_show: "destructive",
  rescheduled: "secondary",
};
