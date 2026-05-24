import Link from "next/link";
import { redirect } from "next/navigation";
import * as Icons from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/configuracion/fiscal", label: "Datos fiscales", icon: "Building2", desc: "Razón social, CIF, IBAN, logo y color PDF" },
  { href: "/configuracion/facturacion", label: "Facturación", icon: "Receipt", desc: "Series, modo Verifactu, certificado FNMT" },
  { href: "/configuracion/mailing", label: "Mailing", icon: "Mail", desc: "Dominio envío + DNS DKIM/SPF + plantillas" },
  { href: "/configuracion/leads", label: "Leads", icon: "Contact", desc: "Caducidad y orígenes" },
  { href: "/configuracion/clientes", label: "Clientes", icon: "Users", desc: "Campos custom y reglas dedupe" },
  { href: "/configuracion/propuestas", label: "Propuestas", icon: "FileText", desc: "Validez, descuentos, aprobaciones" },
  { href: "/configuracion/contratos", label: "Contratos", icon: "FileSignature", desc: "Cláusulas con variables" },
  { href: "/configuracion/instalaciones", label: "Instalaciones", icon: "Wrench", desc: "Tolerancia GPS, tiempos, encuesta" },
  { href: "/configuracion/mantenimientos", label: "Mantenimientos", icon: "ShieldCheck", desc: "Planes Lite/Medium/Premium" },
  { href: "/configuracion/incidencias", label: "Incidencias", icon: "AlertTriangle", desc: "SLA por origen y prioridad" },
  { href: "/configuracion/wallet", label: "Wallet", icon: "Wallet", desc: "Métodos cobro, validación, IBAN" },
  { href: "/configuracion/gocardless", label: "GoCardless", icon: "Banknote", desc: "Domiciliación SEPA · access token + webhook" },
  { href: "/configuracion/financieras", label: "Financieras", icon: "Landmark", desc: "Renting y financiación, coeficientes por plazo" },
  { href: "/configuracion/gastos", label: "Gastos comerciales", icon: "Receipt", desc: "Dietas, kilometraje, OCR Mindee, límites IRPF" },
  { href: "/configuracion/calculadora-ahorro", label: "Calculadora ahorro", icon: "Calculator", desc: "Marcas de agua, scraper precios, parámetros eco" },
  { href: "/configuracion/notificaciones", label: "Notificaciones", icon: "Bell", desc: "Opt-in por evento y canal" },
  { href: "/configuracion/dashboard", label: "Dashboard", icon: "LayoutDashboard", desc: "KPIs por rol y período" },
  { href: "/configuracion/productos", label: "Productos", icon: "Package", desc: "Categorías y atributos" },
  { href: "/configuracion/pruebas-gratuitas", label: "Pruebas gratuitas", icon: "Gift", desc: "Duración y condiciones" },
  { href: "/configuracion/objetivos", label: "Objetivos", icon: "Target", desc: "Metas mensuales por dpto y usuario" },
  { href: "/configuracion/puntos", label: "Programa de puntos", icon: "Trophy", desc: "Puntos, hitos y comisiones €" },
  { href: "/configuracion/plantillas", label: "Plantillas", icon: "FileText", desc: "Mensajes WhatsApp/email base" },
  { href: "/configuracion/horarios", label: "Horarios y vacaciones", icon: "Clock", desc: "Jornada laboral y días por usuario" },
  { href: "/configuracion/festivos", label: "Calendario laboral", icon: "Calendar", desc: "Festivos nacionales y locales" },
  { href: "/configuracion/usuarios", label: "Usuarios", icon: "Users", desc: "Equipo, roles y permisos" },
  { href: "/configuracion/agenda", label: "Agenda", icon: "Calendar", desc: "Horario, tolerancias y tipos de evento" },
  { href: "/configuracion/almacenes", label: "Almacenes", icon: "Warehouse", desc: "Almacenes, furgonetas y stock" },
  { href: "/configuracion/google-maps", label: "Google Maps Tools", icon: "Map", desc: "Mapas, rutas IA, Street View, anti-fraude · consumo y caps" },
  { href: "/configuracion/modulos", label: "Módulos activos", icon: "Layers", desc: "Activar/desactivar módulos por empresa" },
];

export default async function ConfiguracionPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Configuración</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Solo el administrador de la empresa puede modificar la configuración.
          Los datos fiscales, el logo y el color corporativo se gestionan ahora
          dentro de cada módulo correspondiente.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((s) => {
          const Icon =
            (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
              s.icon
            ] ?? Icons.Settings;
          return (
            <Link
              key={s.href}
              href={s.href as never}
              prefetch={false}
              className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md hover:shadow-primary/10"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <div className="font-bold">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.desc}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
