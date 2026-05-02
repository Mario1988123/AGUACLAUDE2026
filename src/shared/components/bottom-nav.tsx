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
 * accesos más usados. Sólo visible en pantallas <lg.
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
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-border bg-card px-1 py-2 lg:hidden">
      {items.map((it) => {
        const Icon = it.icon;
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.key}
            href={it.href as never}
            prefetch={false}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-semibold">{it.label}</span>
            {it.badge != null && it.badge > 0 && (
              <span className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                {it.badge > 9 ? "9+" : it.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNavSpacer() {
  return <div className="h-16 lg:hidden" />;
}
