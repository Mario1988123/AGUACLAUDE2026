// =============================================================================
// modules.ts
// Catálogo de módulos lado cliente (para sidebar). Espejo del seed
// modules_catalog en BD. Si añades un módulo en BD, también aquí.
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

export const MODULES: ModuleEntry[] = [
  { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard", href: "/dashboard", group: "core" },
  { key: "notifications", label: "Notificaciones", icon: "Bell", href: "/notificaciones", group: "core" },
  { key: "agenda", label: "Agenda", icon: "Calendar", href: "/agenda", configHref: "/configuracion/agenda", group: "operative" },
  { key: "leads", label: "Leads", icon: "Contact", href: "/leads", configHref: "/configuracion/leads", group: "operative" },
  { key: "customers", label: "Clientes", icon: "Users", href: "/clientes", group: "operative" },
  { key: "proposals", label: "Propuestas", icon: "FileText", href: "/propuestas", group: "operative" },
  { key: "contracts", label: "Contratos", icon: "FileSignature", href: "/contratos", configHref: "/configuracion/contratos", group: "operative" },
  { key: "free_trials", label: "Pruebas gratuitas", icon: "Gift", href: "/pruebas-gratuitas", configHref: "/configuracion/pruebas-gratuitas", group: "operative" },
  { key: "lost_sales", label: "Ventas perdidas", icon: "TrendingDown", href: "/ventas-perdidas", group: "operative" },
  { key: "products", label: "Productos", icon: "Package", href: "/productos", configHref: "/configuracion/productos", group: "operative" },
  { key: "warehouses", label: "Almacenes", icon: "Warehouse", href: "/almacenes", configHref: "/configuracion/almacenes", group: "operative" },
  { key: "installations", label: "Instalaciones", icon: "Wrench", href: "/instalaciones", group: "operative" },
  { key: "maintenance", label: "Mantenimientos", icon: "ShieldCheck", href: "/mantenimientos", group: "operative" },
  { key: "incidents", label: "Incidencias", icon: "AlertTriangle", href: "/incidencias", group: "operative" },
  { key: "sales", label: "Ventas", icon: "TrendingUp", href: "/ventas", configHref: "/configuracion/objetivos", group: "operative" },
  { key: "wallet", label: "Wallet", icon: "Wallet", href: "/wallet", group: "operative" },
  { key: "audit", label: "Auditoría", icon: "ScrollText", href: "/auditoria", group: "config", rolesAllowed: ["company_admin", "technical_director", "commercial_director", "telemarketing_director"] },
  { key: "settings", label: "Configuración", icon: "Settings", href: "/configuracion", group: "config", rolesAllowed: ["company_admin"] },
];
