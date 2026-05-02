"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Icons from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MODULES, type ModuleEntry } from "@/shared/lib/modules";

interface SidebarProps {
  userRoles: string[];
  isSuperadmin: boolean;
  activeModuleKeys: string[];
  fullName: string | null;
}

/**
 * Sidebar tenant — estilo navy oscuro (var --sidebar de globals.css).
 * Optimizado para tablet: tap targets ≥56px, iconos grandes, espaciado generoso.
 */
export function Sidebar({ userRoles, isSuperadmin, activeModuleKeys, fullName }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleModules = MODULES.filter((m) => {
    if (!activeModuleKeys.includes(m.key)) return false;
    if (m.rolesAllowed && m.rolesAllowed.length > 0) {
      return isSuperadmin || m.rolesAllowed.some((r) => userRoles.includes(r));
    }
    return true;
  });

  const operative = visibleModules.filter((m) => m.group === "operative");
  const core = visibleModules.filter((m) => m.group === "core");
  const config = visibleModules.filter((m) => m.group === "config");

  const sidebarContent = (
    <aside
      className={cn(
        "sidebar-scrollbar flex h-screen flex-col border-r transition-[width] duration-200",
        "bg-sidebar text-sidebar-foreground border-sidebar-border",
        collapsed ? "w-20" : "w-64",
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
        {!collapsed && (
          <Link href="/" className="text-lg font-bold tracking-tight text-sidebar-foreground">
            AGUACLAUDE
          </Link>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="hidden h-11 w-11 items-center justify-center rounded-md hover:bg-sidebar-accent lg:flex"
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
        >
          <Icons.Menu className="h-5 w-5" />
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-sidebar-accent lg:hidden"
          aria-label="Cerrar menú"
        >
          <Icons.X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto p-3">
        <SidebarGroup label="Principal" items={core} pathname={pathname} collapsed={collapsed} />
        <SidebarGroup
          label="Operativa"
          items={operative}
          pathname={pathname}
          collapsed={collapsed}
        />
        <SidebarGroup
          label="Administración"
          items={config}
          pathname={pathname}
          collapsed={collapsed}
        />
      </nav>

      <div className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="truncate px-3 pb-2 text-xs text-sidebar-foreground/60" title={fullName ?? ""}>
            {fullName ?? "Usuario"}
          </div>
        )}
        <form action="/logout" method="post">
          <button
            type="submit"
            className={cn(
              "flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              "hover:bg-sidebar-accent",
              collapsed && "justify-center",
            )}
          >
            <Icons.LogOut className="h-5 w-5" />
            {!collapsed && <span>Salir</span>}
          </button>
        </form>
      </div>
    </aside>
  );

  return (
    <>
      {/* Botón flotante para abrir sidebar en móvil/tablet pequeño */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg lg:hidden"
        aria-label="Abrir menú"
      >
        <Icons.Menu className="h-6 w-6" />
      </button>

      {/* Sidebar desktop */}
      <div className="hidden lg:block">{sidebarContent}</div>

      {/* Sidebar móvil con overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0">{sidebarContent}</div>
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
        <div className="px-3 pt-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
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
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? m.label : undefined}
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
