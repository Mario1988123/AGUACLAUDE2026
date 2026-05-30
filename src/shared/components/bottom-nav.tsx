"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarCheck,
  Bell,
  Wrench,
  Contact,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface Props {
  unreadCount?: number;
}

/**
 * Bottom navigation para móvil. 5 botones grandes (touch friendly) con los
 * accesos más usados. Sólo visible en pantallas <md (en tablet ya tenemos
 * sidebar permanente en modo icono).
 * El sidebar lateral mobile sigue accesible con el botón hamburguesa flotante.
 */
export function BottomNav({ unreadCount = 0 }: Props) {
  const pathname = usePathname();

  const items = [
    { href: "/dashboard", label: "Inicio", icon: LayoutDashboard, key: "dashboard" },
    { href: "/mi-dia", label: "Mi día", icon: CalendarCheck, key: "mi-dia" },
    { href: "/instalaciones", label: "Instal.", icon: Wrench, key: "instalaciones" },
    { href: "/leads", label: "Leads", icon: Contact, key: "leads" },
    { href: "/notificaciones", label: "Avisos", icon: Bell, key: "notificaciones", badge: unreadCount },
  ];

  return (
    <nav
      aria-label="Navegación principal móvil"
      className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-border bg-card px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
    >
      {items.map((it) => {
        const Icon = it.icon;
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        const badgeCount = it.badge ?? 0;
        const ariaLabel =
          badgeCount > 0
            ? `${it.label}, ${badgeCount} ${badgeCount === 1 ? "aviso" : "avisos"} sin leer`
            : it.label;
        return (
          <Link
            key={it.key}
            href={it.href as never}
            prefetch={false}
            aria-label={ariaLabel}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1.5 transition-colors",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-[11px] font-semibold leading-none">{it.label}</span>
            {badgeCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-2 top-0.5 flex h-4 min-w-[1.1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground"
              >
                {badgeCount > 9 ? "9+" : badgeCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNavSpacer() {
  return <div className="h-16 md:hidden" aria-hidden="true" />;
}
