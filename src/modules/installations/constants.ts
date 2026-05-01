export const STATUS_LABEL: Record<string, string> = {
  unscheduled: "Sin agendar",
  scheduled: "Agendada",
  in_progress: "En curso",
  paused: "Pausada",
  completed: "Completada",
  cancelled: "Cancelada",
  incident_pending: "Con incidencia",
};

export const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  unscheduled: "secondary",
  scheduled: "default",
  in_progress: "warning",
  paused: "warning",
  completed: "success",
  cancelled: "destructive",
  incident_pending: "destructive",
};

export const KIND_LABEL: Record<string, string> = {
  normal: "Normal",
  free_trial: "Prueba gratuita",
  relocation: "Reubicación",
};
