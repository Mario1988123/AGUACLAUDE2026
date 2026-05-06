// =============================================================================
// modules.ts
// Catálogo de módulos lado cliente (para sidebar). Espejo del seed
// modules_catalog en BD. Si añades un módulo en BD, también aquí.
//
// rolesAllowed: si está definido, SOLO esos roles ven el módulo en el
// sidebar. Si no, todos los roles con permiso lo verán. Niveles 1
// (company_admin) y superadmin siempre ven todo.
//
// Reglas de negocio (decisión usuario 2026-05):
//
// · Comercial (sales_rep): clientes/propuestas/contratos suyos. NO
//   instalaciones, mantenimientos, incidencias, almacenes, ventas, ni
//   facturas. Recibe notificación al completarse instalación → cobra
//   comisión y suma puntos.
// · Telemarketer: solo agenda y leads (asignar/crear). Nada más.
// · Instalador: instalaciones, mantenimientos, agenda, incidencias,
//   almacenes (su carga). Sin acceso a leads/clientes/propuestas/etc.
// · Niveles 1/2 (admin, directores): todo según scope BD.
// =============================================================================

export interface ModuleEntry {
  key: string;
  label: string;
  icon: string;
  href: string;
  configHref?: string;
  group: "core" | "operative" | "config" | "parked";
  rolesAllowed?: string[]; // si vacío, todos los con permiso lo verán
}

const LEVEL_1_2 = [
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
];

// Roles que ven módulos comerciales (clientes/propuestas/contratos)
const SALES_ROLES = [...LEVEL_1_2, "sales_rep"];
// Roles que ven módulos operativos de campo (instalaciones/mantenimiento)
const FIELD_ROLES = [...LEVEL_1_2, "installer"];
// Roles que ven leads (todo el equipo de ventas + tmk)
const LEADS_ROLES = [...LEVEL_1_2, "sales_rep", "telemarketer"];

export const MODULES: ModuleEntry[] = [
  // ===== CORE — todos los roles =====
  { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard", href: "/dashboard", group: "core" },
  { key: "my_day", label: "Mi día", icon: "CalendarCheck", href: "/mi-dia", group: "core" },
  { key: "points", label: "Puntos", icon: "Trophy", href: "/puntos", group: "core" },
  { key: "notifications", label: "Notificaciones", icon: "Bell", href: "/notificaciones", group: "core" },
  { key: "chat", label: "Chat", icon: "MessageSquare", href: "/chat", group: "core" },
  { key: "time_tracking", label: "Fichajes", icon: "Clock", href: "/fichajes", configHref: "/configuracion/horarios", group: "core" },

  // ===== OPERATIVE =====

  // Agenda: todos (sales_rep, telemarketer e installer la usan).
  { key: "agenda", label: "Agenda", icon: "Calendar", href: "/agenda", configHref: "/configuracion/agenda", group: "operative" },

  // Leads: niveles 1-2 + sales_rep + telemarketer (no installer).
  { key: "leads", label: "Leads", icon: "Contact", href: "/leads", configHref: "/configuracion/leads", group: "operative", rolesAllowed: LEADS_ROLES },

  // Clientes/propuestas/contratos: comercial sí, telemarketer/installer no.
  { key: "customers", label: "Clientes", icon: "Users", href: "/clientes", group: "operative", rolesAllowed: SALES_ROLES },
  { key: "proposals", label: "Propuestas", icon: "FileText", href: "/propuestas", group: "operative", rolesAllowed: SALES_ROLES },
  { key: "contracts", label: "Contratos", icon: "FileSignature", href: "/contratos", configHref: "/configuracion/contratos", group: "operative", rolesAllowed: SALES_ROLES },
  { key: "free_trials", label: "Pruebas gratuitas", icon: "Gift", href: "/pruebas-gratuitas", configHref: "/configuracion/pruebas-gratuitas", group: "operative", rolesAllowed: SALES_ROLES },
  { key: "lost_sales", label: "Ventas perdidas", icon: "TrendingDown", href: "/ventas-perdidas", group: "operative", rolesAllowed: SALES_ROLES },

  // Catálogo de productos: solo niveles 1-2 (gestionan precios/altas).
  { key: "products", label: "Productos", icon: "Package", href: "/productos", configHref: "/configuracion/productos", group: "operative", rolesAllowed: LEVEL_1_2 },

  // Almacenes: niveles 1-2 + instaladores (ven su almacén/vehículo).
  { key: "warehouses", label: "Almacenes", icon: "Warehouse", href: "/almacenes", configHref: "/configuracion/almacenes", group: "operative", rolesAllowed: FIELD_ROLES },

  // Instalaciones / mantenimientos: niveles 1-2 + instaladores. NO comerciales.
  { key: "installations", label: "Instalaciones", icon: "Wrench", href: "/instalaciones", group: "operative", rolesAllowed: FIELD_ROLES },
  { key: "maintenance", label: "Mantenimientos", icon: "ShieldCheck", href: "/mantenimientos", group: "operative", rolesAllowed: FIELD_ROLES },

  // Incidencias: niveles 1-2 + instaladores (las reportan/resuelven).
  { key: "incidents", label: "Incidencias", icon: "AlertTriangle", href: "/incidencias", group: "operative", rolesAllowed: FIELD_ROLES },

  // Ventas (objetivos): niveles 1-2 + sales_rep (ven sus objetivos/comisiones).
  { key: "sales", label: "Ventas", icon: "TrendingUp", href: "/ventas", configHref: "/configuracion/objetivos", group: "operative", rolesAllowed: SALES_ROLES },

  // Wallet (caja/cobros): niveles 1-2 + sales_rep (cobran). Telemarketer/installer no.
  { key: "wallet", label: "Wallet", icon: "Wallet", href: "/wallet", group: "operative", rolesAllowed: SALES_ROLES },

  // Facturación: solo company_admin.
  { key: "invoicing", label: "Facturas", icon: "Receipt", href: "/facturas", configHref: "/configuracion/fiscal", group: "operative", rolesAllowed: ["company_admin"] },

  // ===== CONFIG =====
  { key: "audit", label: "Auditoría", icon: "ScrollText", href: "/auditoria", group: "config", rolesAllowed: LEVEL_1_2 },
  { key: "settings", label: "Configuración", icon: "Settings", href: "/configuracion", group: "config", rolesAllowed: ["company_admin"] },
];
