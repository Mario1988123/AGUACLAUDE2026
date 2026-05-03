"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import * as Icons from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MODULES, type ModuleEntry } from "@/shared/lib/modules";

interface SidebarProps {
  userRoles: string[];
  isSuperadmin: boolean;
  activeModuleKeys: string[];
  fullName: string | null;
}

const COLLAPSED_KEY = "sidebar.collapsed";

/**
 * Sidebar estilo DashStack — fondo blanco, item activo azul, minimizable
 * (escritorio) con preferencia persistida en localStorage. En tablet/móvil
 * se sigue mostrando como overlay con el botón hamburguesa.
 */
export function Sidebar({ userRoles, isSuperadmin, activeModuleKeys, fullName }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Cargar preferencia inicial de localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(COLLAPSED_KEY);
    if (v === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
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

  const visibleModules = MODULES.filter((m) => {
    const isSystem = m.group === "config" || m.group === "core";
    if (!isSystem && !activeModuleKeys.includes(m.key)) return false;
    if (m.rolesAllowed && m.rolesAllowed.length > 0) {
      return isSuperadmin || m.rolesAllowed.some((r) => userRoles.includes(r));
    }
    return true;
  });

  const operative = visibleModules.filter((m) => m.group === "operative");
  const core = visibleModules.filter((m) => m.group === "core");
  const config = visibleModules.filter((m) => m.group === "config");

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

        <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-5">
          <SidebarGroup label="Principal" items={core} pathname={pathname} collapsed={isCollapsed} />
          <SidebarGroup label="Operativa" items={operative} pathname={pathname} collapsed={isCollapsed} />
          <SidebarGroup label="Administración" items={config} pathname={pathname} collapsed={isCollapsed} />
        </nav>

        <div className={cn("border-t border-sidebar-border", isCollapsed ? "p-2" : "p-4")}>
          {!isCollapsed && fullName && (
            <div className="mb-3 truncate px-3 text-xs font-semibold text-muted-foreground">
              {fullName}
            </div>
          )}
          <form action="/logout" method="post">
            <button
              type="submit"
              title="Salir"
              className={cn(
                "flex min-h-12 w-full items-center rounded-xl text-sm font-semibold text-foreground transition-colors hover:bg-sidebar-accent",
                isCollapsed ? "justify-center px-2 py-3" : "gap-3 px-4 py-3",
              )}
            >
              <Icons.LogOut className="h-5 w-5 shrink-0" />
              {!isCollapsed && <span>Salir</span>}
            </button>
          </form>
        </div>
      </aside>
    );
  }

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg lg:hidden"
        aria-label="Abrir menú"
      >
        <Icons.Menu className="h-6 w-6" />
      </button>

      <div className="hidden lg:block">{renderSidebar({ collapsed })}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0">
            {renderSidebar({ collapsed: false, onMobileClose: () => setMobileOpen(false) })}
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
}: {
  label: string;
  items: ModuleEntry[];
  pathname: string;
  collapsed: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {!collapsed && (
        <div className="px-3 pb-2 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </div>
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
            className={cn(
              "relative flex min-h-12 items-center rounded-xl text-sm font-semibold transition-colors",
              collapsed ? "justify-center px-2 py-3" : "gap-3 px-4 py-3",
              active
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
            )}
            prefetch={false}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="truncate">{m.label}</span>}
          </Link>
        );
      })}
    </div>
  );
}
