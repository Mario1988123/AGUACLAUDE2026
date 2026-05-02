export const EVENT_LABEL: Record<string, string> = {
  "lead.created": "Lead creado",
  "lead.contacted": "Contactado",
  "lead.status_changed": "Cambio de estado",
  "customer.created": "Cliente creado",
  "customer.updated": "Cliente actualizado",
  "proposal.created": "Propuesta creada",
  "proposal.sent": "Propuesta enviada",
  "proposal.accepted": "Propuesta aceptada",
  "proposal.rejected": "Propuesta rechazada",
  "contract.created": "Contrato creado",
  "contract.signed": "Contrato firmado",
  "contract.activated": "Contrato activo",
  "installation.scheduled": "Instalación programada",
  "installation.started": "Instalación iniciada",
  "installation.completed": "Instalación completada",
  "maintenance.completed": "Mantenimiento completado",
  "wallet.payment_recorded": "Pago registrado",
};

export function eventLabel(kind: string): string {
  return EVENT_LABEL[kind] ?? kind;
}
