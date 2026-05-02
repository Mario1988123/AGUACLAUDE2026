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
  "maintenance.started": "Mantenimiento iniciado",
  "maintenance.completed": "Mantenimiento completado",
  "wallet.payment_recorded": "Pago registrado",
  "lead.expired": "Lead caducado",
  "incident.created": "Incidencia creada",
  "incident.resolved": "Incidencia resuelta",
};

export const SUBJECT_TYPE_LABEL: Record<string, string> = {
  lead: "Lead",
  customer: "Cliente",
  proposal: "Propuesta",
  contract: "Contrato",
  installation: "Instalación",
  maintenance: "Mantenimiento",
  incident: "Incidencia",
  wallet_entry: "Wallet",
  product: "Producto",
  warehouse: "Almacén",
  free_trial: "Prueba gratuita",
  user: "Usuario",
  company: "Empresa",
};

export function subjectLink(subject_type: string, subject_id: string): string | null {
  switch (subject_type) {
    case "lead":
      return `/leads/${subject_id}`;
    case "customer":
      return `/clientes/${subject_id}`;
    case "proposal":
      return `/propuestas/${subject_id}`;
    case "contract":
      return `/contratos/${subject_id}`;
    case "installation":
      return `/instalaciones/${subject_id}`;
    case "maintenance":
      return `/mantenimientos/${subject_id}`;
    case "incident":
      return `/incidencias/${subject_id}`;
    case "product":
      return `/productos/${subject_id}`;
    default:
      return null;
  }
}

export function eventLabel(kind: string): string {
  return EVENT_LABEL[kind] ?? kind;
}
