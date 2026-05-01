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

export function Sidebar({ userRoles, isSuperadmin, activeModuleKeys, fullName }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

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

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-card transition-[width] duration-200",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-16 items-center justify-between border-b px-4">
        {!collapsed && (
          <Link href="/" className="text-lg font-bold tracking-tight">
            AGUACLAUDE
          </Link>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="rounded p-2 hover:bg-muted"
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
        >
          <Icons.Menu className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        <SidebarGroup label="Principal" items={core} pathname={pathname} collapsed={collapsed} />
        <SidebarGroup label="Operativa" items={operative} pathname={pathname} collapsed={collapsed} />
        <SidebarGroup label="Administración" items={config} pathname={pathname} collapsed={collapsed} />
      </nav>

      <div className="border-t p-3">
        {!collapsed && (
          <div className="truncate text-xs text-muted-foreground" title={fullName ?? ""}>
            {fullName ?? "Usuario"}
          </div>
        )}
        <Link
          href="/logout"
          className={cn(
            "mt-2 flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted",
            collapsed && "justify-center",
          )}
        >
          <Icons.LogOut className="h-4 w-4" />
          {!collapsed && <span>Salir</span>}
        </Link>
      </div>
    </aside>
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
        <div className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      )}
      {items.map((m) => {
        const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[m.icon] ?? Icons.Square;
        const active = pathname === m.href || pathname.startsWith(`${m.href}/`);
        return (
          <Link
            key={m.key}
            href={m.href as never}
            className={cn(
              "flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted",
              collapsed && "justify-center",
            )}
            title={collapsed ? m.label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{m.label}</span>}
          </Link>
        );
      })}
    </div>
  );
}
