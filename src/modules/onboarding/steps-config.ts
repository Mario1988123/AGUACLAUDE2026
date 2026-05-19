// =============================================================================
// steps-config.ts
// Catálogo de pasos de onboarding del CRM. Cada paso tiene:
//   · key único
//   · label + descripción
//   · href donde el admin lo completa
//   · group para agrupar visualmente
//   · importance: 'required' (bloquea operativa) | 'recommended' (importante)
//                 | 'optional' (cuando lo necesite)
//   · auto_check: función que mira la BD y decide si ya está hecho sin
//                 necesidad de marcar manualmente
// =============================================================================

export type StepImportance = "required" | "recommended" | "optional";

export interface OnboardingStep {
  key: string;
  label: string;
  description: string;
  href: string;
  group: "fiscal" | "catalog" | "team" | "operations" | "billing" | "mailing";
  importance: StepImportance;
  /** Pista para auto-completar: tabla y check. Si no hay, solo manual. */
  auto_check?: {
    table: string;
    where?: Record<string, unknown>;
    /** Si min_count rows, se considera hecho. */
    min_count?: number;
    /** Si some column NOT NULL, se considera hecho. */
    not_null_column?: string;
  };
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  // ===== FISCAL Y EMPRESA =====
  {
    key: "fiscal_data",
    label: "Datos fiscales de la empresa",
    description: "Razón social, CIF/NIF, dirección, IBAN, logo y color corporativo. Necesario para emitir facturas y contratos.",
    href: "/configuracion/fiscal",
    group: "fiscal",
    importance: "required",
    auto_check: {
      table: "company_settings",
      not_null_column: "fiscal_tax_id",
    },
  },
  {
    key: "invoicing_series",
    label: "Series de facturación",
    description: "Configura las series de numeración (ej. FACT, FAC1) para tus facturas y abonos.",
    href: "/configuracion/facturacion",
    group: "fiscal",
    importance: "required",
  },
  {
    key: "verifactu_mode",
    label: "Modo Verifactu",
    description: "Elige si tus facturas se envían a AEAT (Verifactu real), si quieres modo test, o si lo dejas desactivado.",
    href: "/configuracion/facturacion",
    group: "fiscal",
    importance: "required",
  },
  {
    key: "sepa_creditor_id",
    label: "Identificador SEPA (CID)",
    description: "Si vas a domiciliar cuotas de alquiler/renting, necesitas el CID que te asigna tu banco para SEPA Core.",
    href: "/configuracion/fiscal",
    group: "fiscal",
    importance: "recommended",
    auto_check: {
      table: "company_settings",
      not_null_column: "sepa_creditor_id",
    },
  },

  // ===== CATÁLOGO =====
  {
    key: "product_categories",
    label: "Categorías de productos",
    description: "Crea al menos una categoría (ósmosis, descalcificadores, filtros, accesorios…) antes de añadir productos.",
    href: "/configuracion/productos",
    group: "catalog",
    importance: "recommended",
    auto_check: { table: "product_categories", min_count: 1 },
  },
  {
    key: "products_added",
    label: "Productos del catálogo",
    description: "Añade los equipos que vendes/alquilas con sus precios. Sin productos no se pueden hacer propuestas ni contratos.",
    href: "/productos",
    group: "catalog",
    importance: "required",
    auto_check: { table: "products", min_count: 1 },
  },
  {
    key: "product_pricing",
    label: "Precios de productos",
    description: "Cada producto debe tener al menos un precio (contado, renting o alquiler) configurado.",
    href: "/productos",
    group: "catalog",
    importance: "required",
  },
  {
    key: "warehouses",
    label: "Almacenes y furgonetas",
    description: "Da de alta tu almacén principal + las furgonetas/vehículos donde llevas stock. Necesario para inventario y rutas.",
    href: "/configuracion/almacenes",
    group: "catalog",
    importance: "recommended",
    auto_check: { table: "warehouses", min_count: 1 },
  },

  // ===== EQUIPO =====
  {
    key: "users_team",
    label: "Equipo (usuarios y roles)",
    description: "Invita a tu equipo (comerciales, instaladores, telemarketers, directores) y asígnales roles.",
    href: "/configuracion/usuarios",
    group: "team",
    importance: "required",
    auto_check: { table: "user_roles", min_count: 2 },
  },
  {
    key: "work_schedules",
    label: "Horarios y vacaciones",
    description: "Define el horario laboral por usuario. Permite controlar fichajes y vacaciones.",
    href: "/configuracion/horarios",
    group: "team",
    importance: "recommended",
  },
  {
    key: "holidays",
    label: "Calendario de festivos",
    description: "Carga los festivos nacionales y locales del año. Afecta a fichajes y agendas.",
    href: "/configuracion/festivos",
    group: "team",
    importance: "optional",
  },

  // ===== OPERACIONES =====
  {
    key: "agenda_config",
    label: "Configuración de agenda",
    description: "Tolerancia GPS, horarios de instalación por defecto, radio de ruta para sugerencias.",
    href: "/configuracion/agenda",
    group: "operations",
    importance: "recommended",
  },
  {
    key: "maintenance_plans",
    label: "Planes de mantenimiento",
    description: "Lite/Medium/Premium con servicios incluidos. Se ofrecen al firmar contratos.",
    href: "/configuracion/mantenimientos",
    group: "operations",
    importance: "optional",
  },
  {
    key: "incident_sla",
    label: "SLA de incidencias",
    description: "Tiempos de respuesta y resolución por origen y prioridad. El cron escalado avisa al técnico al 75%, 100% y 150%.",
    href: "/configuracion/incidencias",
    group: "operations",
    importance: "recommended",
  },

  // ===== COBROS Y FACTURACIÓN =====
  {
    key: "financiers",
    label: "Financieras",
    description: "Si vendes renting, configura financieras con sus coeficientes por plazo. Sin financieras no podrás asignar capital a renting.",
    href: "/configuracion/financieras",
    group: "billing",
    importance: "optional",
    auto_check: { table: "financiers", min_count: 1 },
  },
  {
    key: "gocardless",
    label: "GoCardless (domiciliaciones)",
    description: "Conecta GoCardless para cobrar cuotas de renting/alquiler por SEPA automáticamente.",
    href: "/configuracion/gocardless",
    group: "billing",
    importance: "optional",
  },
  {
    key: "wallet_methods",
    label: "Métodos de cobro y validación",
    description: "Configura quién puede validar pagos del wallet, IBAN de la empresa para transferencias.",
    href: "/configuracion/wallet",
    group: "billing",
    importance: "recommended",
  },

  // ===== MAILING Y COMUNICACIONES =====
  {
    key: "mailing_domain",
    label: "Dominio de envío email",
    description: "Verifica tu dominio (DKIM, SPF) para que los emails lleguen al inbox y no a spam.",
    href: "/configuracion/mailing",
    group: "mailing",
    importance: "recommended",
  },
  {
    key: "email_templates",
    label: "Plantillas de email",
    description: "Personaliza las plantillas (bienvenida tras firma, confirmación de cita, recordatorio…). Hay catálogo del sistema por defecto.",
    href: "/configuracion/mailing",
    group: "mailing",
    importance: "optional",
  },
];

export const STEP_GROUP_LABEL: Record<OnboardingStep["group"], string> = {
  fiscal: "Datos fiscales y facturación",
  catalog: "Catálogo y almacenes",
  team: "Equipo y horarios",
  operations: "Operaciones",
  billing: "Cobros y financieras",
  mailing: "Comunicaciones",
};
