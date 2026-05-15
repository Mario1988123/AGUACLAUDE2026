export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  scheduled: "Agendado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  rescheduled: "Reagendado",
  skipped: "Saltado",
  invoiced: "Facturado",
};

export const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  pending: "secondary",
  scheduled: "default",
  in_progress: "warning",
  completed: "success",
  cancelled: "destructive",
  rescheduled: "secondary",
  skipped: "secondary",
  invoiced: "success",
};

export const KIND_LABEL: Record<string, string> = {
  contracted: "Contratado",
  one_off: "Puntual",
  warranty: "Garantía",
};
