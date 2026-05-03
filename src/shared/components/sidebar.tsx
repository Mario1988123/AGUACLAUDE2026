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
 * Sidebar estilo DashStack — fondo blanco, item activo azul (#4880FF) con
 * texto blanco. Tap targets 56px en táctil.
 */
export function Sidebar({ userRoles, isSuperadmin, activeModuleKeys, fullName }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleModules = MODULES.filter((m) => {
    // Items "system" (config/admin/core) no requieren company_modules — solo rol.
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

  const sidebarContent = (
    <aside
      className={cn(
        "sidebar-scrollbar flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
      )}
    >
      <div className="flex h-20 items-center justify-between border-b border-sidebar-border px-6">
        <Link href="/" className="text-2xl font-extrabold tracking-tight" prefetch={false}>
          <span className="text-primary">Agua</span>
          <span className="text-foreground">Claude</span>
        </Link>
        <button
          onClick={() => setMobileOpen(false)}
          className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-sidebar-accent lg:hidden"
          aria-label="Cerrar menú"
        >
          <Icons.X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        <SidebarGroup label="Principal" items={core} pathname={pathname} />
        <SidebarGroup label="Operativa" items={operative} pathname={pathname} />
        <SidebarGroup label="Administración" items={config} pathname={pathname} />
      </nav>

      <div className="border-t border-sidebar-border p-4">
        {fullName && (
          <div className="mb-3 truncate px-3 text-xs font-semibold text-muted-foreground">
            {fullName}
          </div>
        )}
        <form action="/logout" method="post">
          <button
            type="submit"
            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-sidebar-accent"
          >
            <Icons.LogOut className="h-5 w-5" />
            <span>Salir</span>
          </button>
        </form>
      </div>
    </aside>
  );

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg lg:hidden"
        aria-label="Abrir menú"
      >
        <Icons.Menu className="h-6 w-6" />
      </button>

      <div className="hidden lg:block">{sidebarContent}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
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
}: {
  label: string;
  items: ModuleEntry[];
  pathname: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="px-3 pb-2 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </div>
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
              "relative flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
            )}
            prefetch={false}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="truncate">{m.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
