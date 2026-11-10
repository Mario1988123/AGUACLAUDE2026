"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, Building2, Package, LogOut } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CajonLateral } from "@/shared/components/cajon-lateral";

const LG_PX = 1024;
const MD_PX = 768;
const ID_CAJON = "menu-superadmin";

const ITEMS = [
  { href: "/superadmin", label: "Empresas", icon: Building2, exact: true },
  { href: "/superadmin/catalogo", label: "Catálogo global", icon: Package, exact: false },
] as const;

interface Props {
  email: string | null;
  children: React.ReactNode;
}

/**
 * Shell del superadmin con sidebar responsive:
 *  - <md (móvil): cabecera propia con la hamburguesa + cajón lateral
 *    (el mismo CajonLateral del CRM; ver docs/DISENO_NAVEGACION_MOVIL.md).
 *  - md-lg (tablet): sidebar permanente en modo icono (w-20).
 *  - >=lg (desktop): sidebar permanente expandido (w-60).
 */
export function SuperadminShell({ email, children }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => setIsDesktop(window.innerWidth >= LG_PX);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Cerrar overlay al cambiar de ruta
  useEffect(() => {
    if (mobileOpen) setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const cerrar = () => setMobileOpen(false);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar permanente (tablet + desktop) */}
      <div className="hidden md:block">
        <SidebarPanel
          compact={!isDesktop}
          pathname={pathname}
          email={email}
        />
      </div>

      {/* Cajón móvil: foco, Escape, bloqueo del fondo y arrastre en CajonLateral */}
      <CajonLateral
        id={ID_CAJON}
        abierto={mobileOpen}
        alCerrar={cerrar}
        etiqueta="Menú de superadmin"
        hastaPx={MD_PX}
        className="md:hidden"
        classNamePanel="bg-card"
      >
        <SidebarPanel
          compact={false}
          pathname={pathname}
          email={email}
          onClose={cerrar}
        />
      </CajonLateral>

      {/* Desde md el carril ya absorbe el margen seguro izquierdo. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-muted/20 md:pt-[var(--safe-top)] md:[--safe-left:0px]">
        {/* Cabecera móvil: su fondo sube por detrás de la barra de estado. */}
        <header className="marco-cabecera shrink-0 border-b bg-card pt-[var(--safe-top)] md:hidden">
          <div className="marco-px flex h-14 items-center gap-1 [--marco-pad:0.5rem]">
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Menú de superadmin"
              aria-expanded={mobileOpen}
              aria-controls={ID_CAJON}
              aria-haspopup="dialog"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors duration-100 hover:bg-muted active:bg-muted"
            >
              <Menu className="h-6 w-6" aria-hidden="true" />
            </button>
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
              <img src="/brand/favicon.svg" alt="" className="h-6 w-6 shrink-0" />
              <span className="truncate">Hidromanager · Admin</span>
            </span>
          </div>
        </header>

        {/* En móvil la muesca la cubre la cabecera; desde md no hay cabecera y
            el margen seguro superior lo pone la columna (arriba), para que el
            contenido no se deslice por debajo de la barra de estado. */}
        <main className="marco-px marco-pb flex-1 overflow-y-auto overscroll-contain pt-[var(--marco-pad)] [--marco-pad:0.75rem] sm:[--marco-pad:1rem] md:[--marco-pad:1.25rem] lg:[--marco-pad:1.5rem]">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarPanel({
  compact,
  pathname,
  email,
  onClose,
}: {
  compact: boolean;
  pathname: string;
  email: string | null;
  onClose?: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex flex-col bg-card",
        // Dentro del cajón el ancho, el borde y el margen izquierdo son los del
        // panel; como carril fijo son suyos (box-content: el margen seguro
        // izquierdo se suma por fuera del ancho).
        onClose
          ? "min-h-0 w-full flex-1"
          : "box-content h-dvh border-r pl-[var(--safe-left)] transition-[width] duration-200 ease-out",
        !onClose && (compact ? "w-20" : "w-60"),
      )}
    >
      <div
        className={cn(
          "box-content flex h-14 shrink-0 items-center border-b pt-[var(--safe-top)] font-semibold md:h-16",
          compact ? "justify-center px-2 text-base" : "justify-between pl-4 pr-2",
        )}
      >
        {compact ? (
          <img src="/brand/favicon.svg" alt="Hidromanager" className="h-7 w-7" />
        ) : (
          <>
            <span className="flex items-center gap-2 text-sm tracking-tight">
              <img src="/brand/favicon.svg" alt="Hidromanager" className="h-6 w-6" />
              <span className="font-semibold">Hidromanager · Admin</span>
            </span>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 min-h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-100 hover:bg-muted active:bg-muted md:hidden"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>

      <nav className="cajon-lista flex-1 space-y-1 p-2" aria-label="Navegación superadmin">
        {ITEMS.map((it) => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onClose}
              title={compact ? it.label : undefined}
              aria-label={compact ? it.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-md text-sm font-medium transition-colors duration-100",
                compact ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted active:bg-muted",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {!compact && <span className="truncate">{it.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div
        className={cn(
          "border-t pb-[calc(0.5rem+var(--safe-bottom))]",
          compact ? "px-2 pt-2" : "px-3 pt-3",
        )}
      >
        {!compact && email && (
          <div className="mb-2 truncate text-xs text-muted-foreground" title={email}>
            {email}
          </div>
        )}
        <form action="/logout" method="post">
          <button
            type="submit"
            title={compact ? "Salir" : undefined}
            aria-label={compact ? "Salir" : undefined}
            className={cn(
              "flex min-h-11 w-full items-center rounded-md text-sm font-medium transition-colors duration-100 hover:bg-muted active:bg-muted",
              compact ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!compact && <span>Salir</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}
