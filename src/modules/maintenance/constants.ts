export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  // 'preprogrammed' = preprogramado por sistema al firmar contrato.
  // Necesita validación admin/TMK antes de pasar a 'scheduled'.
  preprogrammed: "Preprogramado",
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
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  pending: "secondary",
  preprogrammed: "outline",
  scheduled: "default",
  in_progress: "warning",
  completed: "success",
  cancelled: "destructive",
  rescheduled: "secondary",
  skipped: "secondary",
  invoiced: "success",
};

export const KIND_LABEL: Record<string, string> = {
  // Mantenimiento dentro del contrato firmado (auto-agendado).
  contracted: "Contratado",
  // Visita puntual entre medias (avería, llamada del cliente, OOC).
  one_off: "Correctivo",
  // Cubierta por garantía del fabricante.
  warranty: "Garantía",
};

/** Colores por kind para diferenciar visualmente en listados. */
export const KIND_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  contracted: "default",
  one_off: "warning",
  warranty: "success",
};
