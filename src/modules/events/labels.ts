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
  "lead.unassigned_by_expiry": "Lead desasignado por caducidad",
  "lead.reassigned": "Lead reasignado",
  "lead.reopened_from_lost": "Lead reabierto desde venta perdida",
  "lead.tampered": "Cambios sospechosos en lead",
  "lead.converted": "Lead convertido a cliente",
  "incident.created": "Incidencia creada",
  "incident.resolved": "Incidencia resuelta",
  "contract.reassigned": "Contrato reasignado",
  "contract.cancelled": "Contrato cancelado",
  "invoice.created": "Factura creada",
  "invoice.paid": "Factura cobrada",
  "proposal.variant_created": "Variante de propuesta creada",
  "customer.merged": "Clientes fusionados",
  "customer.purged": "Cliente borrado definitivamente",
  "customer.anonymized": "Cliente anonimizado (RGPD)",
  "proposal.approved": "Propuesta validada",
  "proposal.approval_rejected": "Aprobación rechazada",
  "proposal.superseded": "Propuesta sustituida",
  "contract_payment.deferred": "Cobro aplazado a la instalación",
  "contract_payment.edited": "Cobro editado",
  "contract.signature_added": "Firma añadida",
  "contract.install_pref_updated": "Preferencia de instalación actualizada",
  "free_trial.created": "Prueba gratuita creada",
  "free_trial.completed": "Prueba gratuita completada",
  "lead.dedupe_warning": "Posible duplicado",
  "lead.assigned": "Lead asignado",
  "user.created": "Usuario creado",
  "user.role_changed": "Rol cambiado",
  "incident.commented": "Comentario en incidencia",
  "wallet.settled": "Liquidación wallet",
  "wallet.payment_validated": "Pago validado",
  "wallet.payment_rejected": "Pago rechazado",
  // === Instalación: kinds añadidos por el wizard nuevo ===
  "installation.paused": "Instalación en pausa",
  "installation.resumed": "Instalación reanudada",
  "installation.incident": "Incidencia durante la instalación",
  "installation.assigned": "Instalación asignada",
  "installation.reassigned": "Instalación reasignada",
  "installation.started_far": "Parte iniciado lejos del cliente",
  "installation.stock_shortage": "Stock insuficiente para la instalación",
  // === Cliente / equipo ===
  "customer.equipment_added": "Equipo añadido al cliente",
  // === Mantenimiento ===
  "maintenance.scheduled": "Mantenimiento programado",
  "maintenance.in_progress": "Mantenimiento en curso",
  "maintenance.cancelled": "Mantenimiento cancelado",
  "maintenance_contract.created": "Contrato de mantenimiento creado",
  "maintenance_contract.cancelled": "Contrato de mantenimiento cancelado",
  // === Agenda ===
  "agenda.created": "Tarea creada",
  "agenda.rescheduled": "Tarea reagendada",
  "agenda.assigned": "Tarea asignada",
  "agenda.reassigned": "Tarea reasignada",
  "agenda.completed": "Tarea completada",
  "agenda.cancelled": "Tarea cancelada",
  // === Time-tracking ===
  "time_tracking.autoclose": "Fichaje autocerrado",
  "time_tracking.manual_edit": "Fichaje editado manualmente",
};

/**
 * Devuelve un label en español para un kind no listado, intentando traducir
 * tokens comunes (created, updated, deleted...) y formateando bonito.
 */
function fallbackLabel(kind: string): string {
  const TOKENS: Record<string, string> = {
    created: "creado",
    updated: "actualizado",
    deleted: "eliminado",
    accepted: "aceptado",
    rejected: "rechazado",
    completed: "completado",
    started: "iniciado",
    cancelled: "cancelado",
    sent: "enviado",
    signed: "firmado",
    approved: "aprobado",
    activated: "activado",
    reassigned: "reasignado",
    converted: "convertido",
    paid: "cobrado",
    recorded: "registrado",
    scheduled: "programado",
    edited: "editado",
    deferred: "aplazado",
    validated: "validado",
    settled: "liquidado",
    merged: "fusionado",
    anonymized: "anonimizado",
    purged: "borrado",
    expired: "caducado",
    contacted: "contactado",
    resolved: "resuelto",
    commented: "comentado",
    tampered: "modificado",
    superseded: "sustituido",
    paused: "en pausa",
    resumed: "reanudado",
    assigned: "asignado",
    incident: "incidencia",
    rescheduled: "reagendado",
    autoclose: "autocerrado",
    autoclosed: "autocerrado",
    equipment_added: "equipo añadido",
    stock_shortage: "stock insuficiente",
    started_far: "iniciado lejos del cliente",
    payment_validated: "pago validado",
    payment_rejected: "pago rechazado",
    payment_recorded: "pago registrado",
    in_progress: "en curso",
    role_changed: "rol cambiado",
    status_changed: "cambio de estado",
    dedupe_warning: "posible duplicado",
    reopened_from_lost: "reabierto desde venta perdida",
    install_pref_updated: "preferencia de instalación actualizada",
    signature_added: "firma añadida",
    variant_created: "variante creada",
    approval_rejected: "aprobación rechazada",
  };
  const SUBJECTS: Record<string, string> = {
    lead: "Lead",
    customer: "Cliente",
    proposal: "Propuesta",
    contract: "Contrato",
    contract_payment: "Cobro",
    installation: "Instalación",
    maintenance: "Mantenimiento",
    maintenance_contract: "Contrato mantenimiento",
    incident: "Incidencia",
    wallet: "Wallet",
    wallet_entry: "Wallet",
    invoice: "Factura",
    product: "Producto",
    user: "Usuario",
    free_trial: "Prueba gratuita",
    agenda: "Tarea",
    time_tracking: "Fichaje",
    points: "Puntos",
    notification: "Notificación",
    document: "Documento",
  };
  const [subj, ...verbParts] = kind.split(".");
  const verbKey = verbParts.join("_");
  const subject = subj ? SUBJECTS[subj] ?? subj : kind;
  if (verbKey && TOKENS[verbKey]) return `${subject} ${TOKENS[verbKey]}`;
  // Como último recurso devolvemos el subject + verbo bonito
  if (verbKey) return `${subject} · ${verbKey.replace(/_/g, " ")}`;
  return kind;
}

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
  return EVENT_LABEL[kind] ?? fallbackLabel(kind);
}
