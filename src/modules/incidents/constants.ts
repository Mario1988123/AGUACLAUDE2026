export const STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  assigned: "Asignada",
  in_progress: "En curso",
  waiting_parts: "Esperando recambio",
  waiting_customer: "Esperando cliente",
  resolved: "Resuelta",
  closed: "Cerrada",
  cancelled: "Cancelada",
};

export const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  open: "destructive",
  assigned: "warning",
  in_progress: "warning",
  waiting_parts: "secondary",
  waiting_customer: "secondary",
  resolved: "success",
  closed: "outline",
  cancelled: "secondary",
};

export const PRIORITY_LABEL: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

export const PRIORITY_VARIANT: Record<
  string,
  "default" | "secondary" | "warning" | "destructive"
> = {
  low: "secondary",
  medium: "default",
  high: "warning",
  critical: "destructive",
};

export const ORIGIN_LABEL: Record<string, string> = {
  installation_out_of_time: "Instalación fuera de plazo",
  installer_reported: "Reportada por instalador",
  equipment_failure: "Avería de equipo",
  geo_out_of_range: "Geo fuera de rango",
  model_changed: "Cambio de modelo",
  out_of_stock: "Falta de stock",
  customer_complaint: "Queja cliente",
  other: "Otro",
};
