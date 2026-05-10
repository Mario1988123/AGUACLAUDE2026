// =============================================================================
// modules.ts
// Catálogo de módulos lado cliente (sidebar). Agrupados por flujo de uso
// (decisión usuario 2026-05-08).
//
// Grupos en orden de aparición:
//  1. main         — Dashboard / Mi día / Agenda
//  2. sales        — Leads / Clientes / Propuestas / Pruebas / Contratos
//  3. revenue      — Ventas (objetivos) / Ventas perdidas / Mailing*
//  4. operations   — Instalaciones / Mantenimientos / Incidencias / Almacenes
//  5. catalog      — Productos
//  6. billing      — Wallet (cobros) / Facturas
//  7. personal     — Fichajes / Chat / Puntos
//  8. system       — Auditoría / Configuración
//
// rolesAllowed por módulo (decisión 2026-05-07):
//  - Comercial: ve sales + revenue (sin mailing aún) + billing.wallet.
//  - Telemarketer: solo Mi día / Agenda / Leads + Personal.
//  - Instalador: Mi día / Agenda / Operations + Personal.
//  - Niveles 1/2: ven todo según scope.
//
// Notificaciones NO aparecen como módulo: están en la campana del header.
// =============================================================================

export interface ModuleEntry {
  key: string;
  label: string;
  icon: string;
  href: string;
  configHref?: string;
  group:
    | "main"
    | "sales"
    | "revenue"
    | "operations"
    | "catalog"
    | "billing"
    | "personal"
    | "system";
  rolesAllowed?: string[];
}

export interface SidebarGroupDef {
  key: ModuleEntry["group"];
  label: string;
}

export const SIDEBAR_GROUPS: SidebarGroupDef[] = [
  { key: "main", label: "Inicio" },
  { key: "sales", label: "Comercial" },
  { key: "revenue", label: "Ventas" },
  { key: "operations", label: "Operaciones" },
  { key: "catalog", label: "Catálogo y stock" },
  { key: "billing", label: "Cobros y facturación" },
  { key: "personal", label: "Personal" },
  { key: "system", label: "Sistema" },
];

const LEVEL_1_2 = [
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
];

const SALES_ROLES = [...LEVEL_1_2, "sales_rep"];
const FIELD_ROLES = [...LEVEL_1_2, "installer"];
const LEADS_ROLES = [...LEVEL_1_2, "sales_rep", "telemarketer"];

export const MODULES: ModuleEntry[] = [
  // ===== 1. INICIO — todos =====
  { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard", href: "/dashboard", group: "main" },
  { key: "my_day", label: "Mi día", icon: "CalendarCheck", href: "/mi-dia", group: "main" },
  { key: "agenda", label: "Agenda", icon: "Calendar", href: "/agenda", configHref: "/configuracion/agenda", group: "main" },

  // ===== 2. COMERCIAL =====
  { key: "leads", label: "Leads", icon: "Contact", href: "/leads", configHref: "/configuracion/leads", group: "sales", rolesAllowed: LEADS_ROLES },
  { key: "customers", label: "Clientes", icon: "Users", href: "/clientes", group: "sales", rolesAllowed: SALES_ROLES },
  { key: "proposals", label: "Propuestas", icon: "FileText", href: "/propuestas", group: "sales", rolesAllowed: SALES_ROLES },
  { key: "free_trials", label: "Pruebas gratuitas", icon: "Gift", href: "/pruebas-gratuitas", configHref: "/configuracion/pruebas-gratuitas", group: "sales", rolesAllowed: SALES_ROLES },
  { key: "savings_calculator", label: "Calculadora ahorro", icon: "Calculator", href: "/calculadora-ahorro", configHref: "/configuracion/calculadora-ahorro", group: "sales", rolesAllowed: SALES_ROLES },
  { key: "contracts", label: "Contratos", icon: "FileSignature", href: "/contratos", configHref: "/configuracion/contratos", group: "sales", rolesAllowed: SALES_ROLES },

  // ===== 3. VENTAS (resultado) =====
  { key: "sales", label: "Objetivos", icon: "Target", href: "/objetivos", configHref: "/configuracion/objetivos", group: "revenue", rolesAllowed: SALES_ROLES },
  { key: "lost_sales", label: "Ventas perdidas", icon: "TrendingDown", href: "/ventas-perdidas", group: "revenue", rolesAllowed: SALES_ROLES },
  // mailing — pendiente desarrollo (próxima iteración)
  // { key: "mailing", label: "Campañas", icon: "Mail", href: "/mailing", group: "revenue", rolesAllowed: SALES_ROLES },

  // ===== 4. OPERACIONES (campo) =====
  { key: "installations", label: "Instalaciones", icon: "Wrench", href: "/instalaciones", group: "operations", rolesAllowed: FIELD_ROLES },
  { key: "maintenance", label: "Mantenimientos", icon: "ShieldCheck", href: "/mantenimientos", group: "operations", rolesAllowed: FIELD_ROLES },
  { key: "incidents", label: "Incidencias", icon: "AlertTriangle", href: "/incidencias", group: "operations", rolesAllowed: FIELD_ROLES },

  // ===== 5. CATÁLOGO Y STOCK (productos + almacenes juntos) =====
  { key: "products", label: "Productos", icon: "Package", href: "/productos", configHref: "/configuracion/productos", group: "catalog", rolesAllowed: LEVEL_1_2 },
  { key: "warehouses", label: "Almacenes", icon: "Warehouse", href: "/almacenes", configHref: "/configuracion/almacenes", group: "catalog", rolesAllowed: FIELD_ROLES },

  // ===== 6. COBROS Y FACTURACIÓN =====
  { key: "wallet", label: "Wallet", icon: "Wallet", href: "/wallet", group: "billing", rolesAllowed: SALES_ROLES },
  { key: "invoicing", label: "Facturas", icon: "Receipt", href: "/facturas", configHref: "/configuracion/facturacion", group: "billing", rolesAllowed: ["company_admin"] },

  // ===== 7. PERSONAL =====
  { key: "time_tracking", label: "Fichajes", icon: "Clock", href: "/fichajes", configHref: "/configuracion/horarios", group: "personal" },
  { key: "expenses", label: "Mis gastos", icon: "Receipt", href: "/gastos", configHref: "/configuracion/gastos", group: "personal" },
  { key: "chat", label: "Chat", icon: "MessageSquare", href: "/chat", group: "personal" },
  { key: "points", label: "Puntos", icon: "Trophy", href: "/puntos", group: "personal" },

  // ===== 8. SISTEMA =====
  { key: "audit", label: "Auditoría", icon: "ScrollText", href: "/auditoria", group: "system", rolesAllowed: LEVEL_1_2 },
  { key: "settings", label: "Configuración", icon: "Settings", href: "/configuracion", group: "system", rolesAllowed: ["company_admin"] },
];
