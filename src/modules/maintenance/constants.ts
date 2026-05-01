export const STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  rescheduled: "Reagendado",
};

export const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  scheduled: "default",
  in_progress: "warning",
  completed: "success",
  cancelled: "destructive",
  rescheduled: "secondary",
};
