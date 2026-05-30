"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import * as Icons from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MODULES, SIDEBAR_GROUPS, type ModuleEntry } from "@/shared/lib/modules";

interface SidebarProps {
  userRoles: string[];
  isSuperadmin: boolean;
  activeModuleKeys: string[];
  fullName: string | null;
  badges?: Partial<Record<string, number>>;
  /** Overrides de módulos del usuario: granted=true fuerza acceso, false lo niega */
  moduleOverrides?: Record<string, boolean>;
}

const COLLAPSED_KEY = "sidebar.collapsed";
const LG_BREAKPOINT_PX = 1024;

/**
 * Sidebar estilo DashStack — fondo blanco, item activo azul.
 *
 * Comportamiento responsive:
 *  - Móvil (<md, <768px): overlay con hamburguesa flotante.
 *  - Tablet (md-lg, 768-1023px): sidebar permanente en modo icono (w-20),
 *    no se puede expandir (los técnicos/comerciales tocan iconos, ahorran espacio).
 *  - Desktop (>=lg, 1024+): sidebar permanente, el usuario puede expandir/colapsar
 *    y la preferencia se persiste en localStorage.
 */
export function Sidebar({
  userRoles,
  isSuperadmin,
  activeModuleKeys,
  fullName,
  badges,
  moduleOverrides,
}: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Cargar preferencia inicial de localStorage + forzar collapsed en tablet.
  // En tablet (md-lg) el sidebar siempre está en modo icono, regardless del estado guardado.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const isDesktop = window.innerWidth >= LG_BREAKPOINT_PX;
      if (!isDesktop) {
        setCollapsed(true);
        return;
      }
      const v = window.localStorage.getItem(COLLAPSED_KEY);
      setCollapsed(v === "1");
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  function toggleCollapsed() {
    // No permitir toggle en tablet: el sidebar tablet es siempre modo icono.
    if (typeof window !== "undefined" && window.innerWidth < LG_BREAKPOINT_PX) return;
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* no-op */
      }
      // Notifica al body para que un layout externo pueda ajustar margen si lo necesitase
      document.body.dataset.sidebarCollapsed = next ? "1" : "0";
      return next;
    });
  }

  // Módulos siempre visibles para cualquier rol (sin depender de
  // company_modules activos): Inicio (dashboard, mi día, agenda),
  // Personal (fichaje, chat, puntos) y Sistema (mailing, mail, rrss, config).
  // El control fino de "módulo off" lo aplican los guards de página
  // (assertModuleActive), que ocultan/redirigen solo si la empresa lo ha
  // desactivado EXPLÍCITAMENTE. Así no desaparecen módulos de empresas que
  // simplemente no tienen fila en company_modules.
  const ALWAYS_ON_GROUPS = new Set<ModuleEntry["group"]>([
    "main",
    "personal",
    "system",
  ]);

  const visibleModules = MODULES.filter((m) => {
    // Override del admin para este usuario tiene precedencia absoluta
    const ov = moduleOverrides?.[m.key];
    if (ov === false) return false;
    if (ov === true) return true;
    if (!ALWAYS_ON_GROUPS.has(m.group) && !activeModuleKeys.includes(m.key))
      return false;
    if (m.rolesAllowed && m.rolesAllowed.length > 0) {
      return isSuperadmin || m.rolesAllowed.some((r) => userRoles.includes(r));
    }
    return true;
  });

  // Agrupar por group respetando el orden de SIDEBAR_GROUPS
  const groupedModules = SIDEBAR_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: visibleModules.filter((m) => m.group === g.key),
  })).filter((g) => g.items.length > 0);

  function renderSidebar(opts: { collapsed: boolean; onMobileClose?: () => void }) {
    const isCollapsed = opts.collapsed;
    return (
      <aside
        className={cn(
          "sidebar-scrollbar flex h-screen flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200 ease-out",
          isCollapsed ? "w-20" : "w-64",
        )}
      >
        <div
          className={cn(
            "relative flex h-20 items-center border-b border-sidebar-border",
            isCollapsed ? "justify-center px-2" : "justify-between px-6",
          )}
        >
          <Link
            href="/"
            className="text-2xl font-extrabold tracking-tight"
            prefetch={false}
            aria-label="AguaClaude"
          >
            {isCollapsed ? (
              <span className="text-primary">A</span>
            ) : (
              <>
                <span className="text-primary">Agua</span>
                <span className="text-foreground">Claude</span>
              </>
            )}
          </Link>
          {opts.onMobileClose && !isCollapsed && (
            <button
              onClick={opts.onMobileClose}
              className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-sidebar-accent lg:hidden"
              aria-label="Cerrar menú"
            >
              <Icons.X className="h-5 w-5" />
            </button>
          )}
          {/* Toggle colapsar (sólo desktop, no mobile overlay) */}
          {!opts.onMobileClose && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={isCollapsed ? "Expandir sidebar" : "Colapsar sidebar"}
              className="absolute -right-3 top-7 hidden h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-card text-muted-foreground shadow-sm hover:text-primary hover:border-primary lg:flex"
            >
              {isCollapsed ? (
                <Icons.ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <Icons.ChevronLeft className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
          {groupedModules.map((g) => (
            <SidebarGroup
              key={g.key}
              label={g.label}
              items={g.items}
              pathname={pathname}
              collapsed={isCollapsed}
              badges={badges}
              onItemClick={opts.onMobileClose}
            />
          ))}
        </nav>

      </aside>
    );
  }

  // Si la ruta cambia, cerramos el overlay automáticamente. Cubre el
  // caso de Link prefetch + navegación en background donde el onClick
  // del item podría llegar después.
  useEffect(() => {
    if (mobileOpen) setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Bloqueamos scroll del body cuando el overlay móvil está abierto
  // para que el contenido detrás no se mueva.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileOpen]);

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
        aria-label="Abrir menú"
      >
        <Icons.Menu className="h-6 w-6" />
      </button>

      <div className="hidden md:block">{renderSidebar({ collapsed })}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop con animación de fade-in */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          {/* Panel deslizante desde la izquierda */}
          <div className="absolute left-0 top-0 h-full max-h-screen animate-in slide-in-from-left duration-200 shadow-2xl">
            {renderSidebar({
              collapsed: false,
              onMobileClose: () => setMobileOpen(false),
            })}
          </div>
        </div>
      )}
    </>
  );
}

function SidebarGroup({
  label,
  items,
  pathname,
  collapsed,
  badges,
  onItemClick,
}: {
  label: string;
  items: ModuleEntry[];
  pathname: string;
  collapsed: boolean;
  badges?: Partial<Record<string, number>>;
  /** Si está definido (modo overlay móvil), se invoca al pulsar un
   *  item para cerrar el sidebar y volver a la página. */
  onItemClick?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {!collapsed ? (
        <div className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/50">
          {label}
        </div>
      ) : (
        <div className="my-1 mx-2 h-px bg-sidebar-border/50" />
      )}
      {items.map((m) => {
        const Icon =
          (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
            m.icon
          ] ?? Icons.Square;
        const active = pathname === m.href || pathname.startsWith(`${m.href}/`);
        return (
          <Link
            key={m.key}
            href={m.href as never}
            title={collapsed ? m.label : undefined}
            onClick={onItemClick}
            className={cn(
              "relative flex min-h-11 items-center rounded-lg text-sm font-semibold transition-colors",
              collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
              active
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
            )}
            prefetch={false}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="truncate flex-1">{m.label}</span>}
            {(() => {
              const count = badges?.[m.key] ?? 0;
              if (!count) return null;
              return (
                <span
                  className={cn(
                    "shrink-0 rounded-full bg-red-500 text-[10px] font-bold text-white",
                    collapsed
                      ? "absolute right-0 top-0 h-4 min-w-4 px-1 leading-4 text-center"
                      : "px-2 py-0.5",
                  )}
                >
                  {count > 99 ? "99+" : count}
                </span>
              );
            })()}
          </Link>
        );
      })}
    </div>
  );
}
