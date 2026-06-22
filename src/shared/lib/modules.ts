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

// Orden de los bloques (decisión usuario 2026-06-22):
//  Inicio → Comercial → Catálogo y stock → Operaciones → Ventas → resto.
export const SIDEBAR_GROUPS: SidebarGroupDef[] = [
  { key: "main", label: "Inicio" },
  { key: "sales", label: "Comercial" },
  { key: "catalog", label: "Catálogo y stock" },
  { key: "operations", label: "Operaciones" },
  { key: "revenue", label: "Ventas" },
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
  // Referidos — opt-in (default activado). Amigos recomendados por clientes con
  // equipos entran como leads asociados al cliente recomendador.
  { key: "referrals", label: "Referidos", icon: "UsersRound", href: "/referidos", group: "sales", rolesAllowed: SALES_ROLES },
  { key: "proposals", label: "Propuestas", icon: "FileText", href: "/propuestas", group: "sales", rolesAllowed: SALES_ROLES },
  { key: "free_trials", label: "Pruebas gratuitas", icon: "Gift", href: "/pruebas-gratuitas", configHref: "/configuracion/pruebas-gratuitas", group: "sales", rolesAllowed: SALES_ROLES },
  { key: "savings_calculator", label: "Calculadora ahorro", icon: "Calculator", href: "/calculadora-ahorro", configHref: "/configuracion/calculadora-ahorro", group: "sales", rolesAllowed: SALES_ROLES },
  { key: "contracts", label: "Contratos", icon: "FileSignature", href: "/contratos", configHref: "/configuracion/contratos", group: "sales", rolesAllowed: SALES_ROLES },

  // ===== 3. VENTAS (resultado) =====
  { key: "sales", label: "Objetivos", icon: "Target", href: "/objetivos", configHref: "/configuracion/objetivos", group: "revenue", rolesAllowed: SALES_ROLES },
  { key: "lost_sales", label: "Ventas perdidas", icon: "TrendingDown", href: "/ventas-perdidas", group: "revenue", rolesAllowed: SALES_ROLES },
  // Comisiones: cualquier comercial/TMK/instalador ve SUS comisiones
  // personales en /comisiones (sólo lo suyo). Cerrar ciclos sigue
  // siendo admin/director (gating dentro de la página).
  { key: "commissions", label: "Comisiones", icon: "Coins", href: "/comisiones", configHref: "/configuracion/puntos", group: "revenue", rolesAllowed: [...LEVEL_1_2, "sales_rep", "telemarketer", "installer"] },
  // mailing — pendiente desarrollo (próxima iteración)
  // { key: "mailing", label: "Campañas", icon: "Mail", href: "/mailing", group: "revenue", rolesAllowed: SALES_ROLES },

  // ===== 4. OPERACIONES (campo) =====
  { key: "installations", label: "Instalaciones", icon: "Wrench", href: "/instalaciones", group: "operations", rolesAllowed: FIELD_ROLES },
  { key: "maintenance", label: "Mantenimientos", icon: "ShieldCheck", href: "/mantenimientos", group: "operations", rolesAllowed: FIELD_ROLES },
  { key: "incidents", label: "Incidencias", icon: "AlertTriangle", href: "/incidencias", group: "operations", rolesAllowed: FIELD_ROLES },
  // Rutas con IA — módulo opcional. Si OFF: /mi-dia solo lista
  // cronológica. Si ON: optimización ruta diaria + vista equipo para
  // nivel 1/2. Calidad: Haversine NN local (gratis) o Routes API
  // Google si la empresa también tiene smart_routes activo.
  { key: "routes", label: "Rutas", icon: "Map", href: "/rutas", group: "operations", rolesAllowed: [...LEVEL_1_2, "installer", "sales_rep", "telemarketer"] },

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
  // Eventos y Auditoría retirados del sidebar admin (decisión usuario
  // 2026-05-18): el timeline ya está accesible en cada ficha
  // individual y el audit log se centraliza en /superadmin/audit con
  // visibilidad solo para superadmin.
  // Mailing: SOLO el departamento de telemarketing (decisión usuario
  // 2026-05-29). telemarketing_director + telemarketer. Se mantiene
  // company_admin porque es quien configura el SMTP/Resend del módulo.
  { key: "mailing", label: "Mailing", icon: "Mail", href: "/mailing", configHref: "/configuracion/mailing", group: "system", rolesAllowed: ["company_admin", "telemarketing_director", "telemarketer"] },
  // MAIL: histórico de TODOS los emails enviados (manuales + automáticos del
  // sistema + campañas). Distinto de "Mailing" (que es campañas marketing).
  // Visible para todos los roles que envían/reciben emails de leads y clientes
  // (almacén queda fuera). El scoping fino lo aplica el módulo (admin todo,
  // directores su equipo, nivel 3 lo suyo).
  { key: "mail", label: "Mail", icon: "Inbox", href: "/mail", group: "system", rolesAllowed: [...LEVEL_1_2, "sales_rep", "telemarketer", "installer"] },
  // RRSS: calendario editorial automático para Instagram, Facebook,
  // LinkedIn, TikTok, Google Business, blog y newsletter. Centrado en
  // contenido de tratamiento del agua, sostenibilidad y efemérides.
  { key: "social_media", label: "RRSS", icon: "Megaphone", href: "/rrss", configHref: "/configuracion/rrss", group: "system", rolesAllowed: LEVEL_1_2 },
  { key: "settings", label: "Configuración", icon: "Settings", href: "/configuracion", group: "system", rolesAllowed: ["company_admin"] },
];

/**
 * Iconos por defecto del menú inferior del MÓVIL (BottomNav) según el rol.
 * El nivel 3 usa el móvil mucho más que el 1/2, así que le ponemos arriba lo
 * que más usa. El usuario puede reordenarlo/cambiarlo en
 * /configuracion/menu-movil. "notifications" es un pseudo-módulo (la campana).
 *
 * Los componentes filtran luego estas keys contra los módulos a los que el
 * usuario tiene acceso real, así que sobra con listar las preferentes.
 */
export function defaultBottomNavKeysForRoles(roles: string[]): string[] {
  const has = (r: string) => roles.includes(r);
  const isLeader = roles.some((r) => LEVEL_1_2.includes(r));
  if (!isLeader) {
    // Nivel 3 TÉCNICO (instalador): agenda + instalaciones + mantenimientos.
    if (has("installer")) {
      return [
        "agenda",
        "installations",
        "maintenance",
        "my_day",
        "dashboard",
        "notifications",
      ];
    }
    // Nivel 3 COMERCIAL.
    if (has("sales_rep")) {
      return ["agenda", "leads", "customers", "my_day", "dashboard", "notifications"];
    }
    // Nivel 3 TELEMARKETING.
    if (has("telemarketer")) {
      return ["agenda", "leads", "my_day", "dashboard", "notifications"];
    }
  }
  // Niveles 1/2 (admin/directores) y cualquier otro: default general histórico.
  return ["dashboard", "my_day", "installations", "leads", "notifications"];
}
