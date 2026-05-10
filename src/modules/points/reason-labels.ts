/**
 * Etiquetas en español para el campo `reason` de points_ledger.
 * Se usan en la UI de comisiones / hitos / histórico.
 */
export const REASON_LABEL: Record<string, string> = {
  lead_captured: "Lead captado",
  sale: "Venta cerrada",
  sale_with_discount: "Venta cerrada (con descuento)",
  sale_tmk_split: "Split TMK por venta de su lead",
  installation_completed: "Instalación completada",
  maintenance_completed: "Mantenimiento completado",
  incident_resolved: "Incidencia resuelta",
  milestone_reached: "Hito de mes alcanzado",
};

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}
