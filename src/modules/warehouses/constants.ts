export const KIND_LABEL: Record<"main" | "secondary" | "vehicle" | "external_supplier", string> = {
  main: "Principal",
  secondary: "Secundario",
  vehicle: "Furgoneta",
  external_supplier: "Proveedor externo",
};

export const STATUS_LABEL_LR: Record<string, string> = {
  requested: "Solicitada",
  preparing: "Preparando",
  prepared: "Preparada",
  in_transit: "En tránsito",
  delivered: "Entregada",
  cancelled: "Cancelada",
};
