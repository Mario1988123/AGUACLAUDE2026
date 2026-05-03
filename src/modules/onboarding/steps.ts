/**
 * NOTA: el icon es un STRING con el nombre del icono de lucide-react.
 * No usamos el componente directamente porque este objeto se serializa
 * desde server hacia el client component <OnboardingTour /> y los
 * componentes React no son serializables como props.
 */
export interface OnboardingStep {
  /** Texto del título corto */
  title: string;
  /** Texto del paso */
  body: string;
  /** Ruta a navegar opcional (botón "Ver") */
  href?: string;
  /** Nombre del icono lucide-react (e.g. "LayoutGrid"). Resuelto en cliente. */
  icon: string;
  /** URL de vídeo embebido (YouTube, Vimeo, Loom). Opcional. */
  video_url?: string;
}

const STEPS_COMMERCIAL: OnboardingStep[] = [
  {
    title: "Tu menú lateral",
    body: "Desde aquí accedes a todas las áreas. Pulsa el icono > para minimizarlo y ganar espacio.",
    icon: "LayoutGrid",
  },
  {
    title: "Leads",
    body: "Aquí tienes tus oportunidades captadas por TMK o por ti. El estado se actualiza al llamar/escribir.",
    href: "/leads",
    icon: "Users",
  },
  {
    title: "Crear propuesta",
    body: "Desde un lead, pulsa 'Nueva propuesta' para preparar la oferta al cliente.",
    href: "/propuestas/nueva",
    icon: "FileText",
  },
  {
    title: "Aceptar propuesta",
    body: "Cuando el cliente firma, marca la propuesta como aceptada y se generará el contrato automáticamente.",
    href: "/propuestas",
    icon: "CheckCircle2",
  },
  {
    title: "Ficha de cliente",
    body: "Completa los datos del cliente (DNI/IBAN se validan en directo, dirección con geolocalización).",
    href: "/clientes",
    icon: "UserPlus",
  },
  {
    title: "Contrato",
    body: "Revisa el contrato generado, asigna técnico y genera el PDF firmable.",
    href: "/contratos",
    icon: "FileSignature",
  },
  {
    title: "Wallet",
    body: "Aquí ves tus puntos, comisiones, cobros pendientes y el histórico.",
    href: "/wallet",
    icon: "Wallet",
  },
  {
    title: "Pruebas gratuitas",
    body: "Si entregas un equipo en prueba, gestiona la conversión a venta o devolución desde aquí.",
    href: "/pruebas-gratuitas",
    icon: "Gift",
  },
  {
    title: "Dashboard y objetivos",
    body: "Tu progreso del mes vs objetivo. Las tarjetas se actualizan en tiempo real.",
    href: "/dashboard",
    icon: "Target",
  },
];

const STEPS_TECH: OnboardingStep[] = [
  {
    title: "Tu menú lateral",
    body: "Desde aquí accedes a tus áreas. Puedes minimizarlo con el icono > para ganar espacio.",
    icon: "LayoutGrid",
  },
  {
    title: "Mi día",
    body: "La pantalla principal: ves todas tus paradas del día y puedes optimizar la ruta por proximidad.",
    href: "/mi-dia",
    icon: "Sun",
  },
  {
    title: "Instalaciones",
    body: "Lista de instalaciones asignadas. Entra en una para iniciar, pausar y completar con firma.",
    href: "/instalaciones",
    icon: "Wrench",
  },
  {
    title: "Mantenimientos",
    body: "Lista de mantenimientos. Al completar puedes registrar piezas reemplazadas (descuenta del almacén).",
    href: "/mantenimientos",
    icon: "ShieldCheck",
  },
  {
    title: "Wallet",
    body: "Aquí ves tus puntos por trabajos completados y, si tu empresa lo activa, su valor en €.",
    href: "/wallet",
    icon: "Wallet",
  },
];

const STEPS_TMK: OnboardingStep[] = [
  {
    title: "Tu menú lateral",
    body: "Desde aquí accedes a tus áreas. Puedes minimizarlo con el icono > para ganar espacio.",
    icon: "LayoutGrid",
  },
  {
    title: "Leads",
    body: "Aquí captas oportunidades. Cada lead nuevo te suma puntos en cuanto lo creas.",
    href: "/leads",
    icon: "Phone",
  },
  {
    title: "Clientes (creados por mí)",
    body: "Filtra por 'creados por mí' para ver si los leads que captaste se convirtieron en venta.",
    href: "/clientes",
    icon: "Users",
  },
  {
    title: "Puntos",
    body: "Tu ranking del mes y del año. Compite con tu equipo y supera tus objetivos.",
    href: "/puntos",
    icon: "Trophy",
  },
];

const STEPS_SUPERADMIN: OnboardingStep[] = [
  {
    title: "Bienvenido superadmin",
    body: "Eres el administrador global. Desde aquí gestionas empresas inquilinas y el catálogo común.",
    icon: "Building2",
  },
  {
    title: "Empresas",
    body: "Da de alta clientes SaaS y configura sus módulos activos.",
    href: "/superadmin",
    icon: "Building2",
  },
  {
    title: "Catálogo global",
    body: "Categorías, atributos y productos de fábrica que cualquier empresa puede activar.",
    href: "/superadmin/catalogo",
    icon: "Package",
  },
];

const STEPS_ADMIN: OnboardingStep[] = [
  {
    title: "Tu menú lateral",
    body: "Como admin tienes acceso a toda la operativa y a Configuración.",
    icon: "LayoutGrid",
  },
  {
    title: "Dashboard",
    body: "Visión global: ventas del mes, ranking, objetivos y atajos a todas las áreas.",
    href: "/dashboard",
    icon: "Target",
  },
  {
    title: "Configuración",
    body: "Define usuarios, productos, plantillas, programa de puntos y comisiones.",
    href: "/configuracion",
    icon: "LayoutGrid",
  },
  {
    title: "Programa de puntos",
    body: "Configura cuántos puntos otorgar por cada acción y, opcionalmente, su conversión a €.",
    href: "/configuracion/puntos",
    icon: "Trophy",
  },
];

/**
 * Devuelve el recorrido apropiado según roles. Prioridad: superadmin > admin > comercial > tmk > técnico.
 */
export function getStepsForRoles(roles: string[], isSuperadmin: boolean): OnboardingStep[] {
  if (isSuperadmin && roles.length === 0) return STEPS_SUPERADMIN;
  if (roles.includes("company_admin")) return STEPS_ADMIN;
  if (isSuperadmin) return STEPS_SUPERADMIN;
  if (
    roles.includes("commercial_director") ||
    roles.includes("sales_rep")
  )
    return STEPS_COMMERCIAL;
  if (
    roles.includes("telemarketing_director") ||
    roles.includes("telemarketer")
  )
    return STEPS_TMK;
  if (roles.includes("technical_director") || roles.includes("installer")) return STEPS_TECH;
  // fallback: comercial
  return STEPS_COMMERCIAL;
}

/**
 * Convierte URLs de YouTube/Vimeo/Loom a su forma embebible.
 */
export function toEmbedUrl(url: string): string {
  // YouTube watch
  let m = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  // YouTube short
  m = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  // Vimeo
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  // Loom
  m = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (m) return `https://www.loom.com/embed/${m[1]}`;
  return url;
}
