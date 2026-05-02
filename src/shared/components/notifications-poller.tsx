"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import Link from "next/link";
import { fetchUnreadCount } from "@/modules/notifications/actions-extra";

interface Props {
  initialCount: number;
  intervalMs?: number;
}

/**
 * Bell con polling suave del contador de notificaciones sin leer.
 * Próximo paso (fase 2): suscripción Supabase Realtime.
 */
export function NotificationsBell({ initialCount, intervalMs = 30000 }: Props) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const n = await fetchUnreadCount();
        if (active) setCount(n);
      } catch {
        /* silent */
      }
    };
    const id = setInterval(tick, intervalMs);
    // refresh inmediato al volver a la pestaña
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs]);

  return (
    <Link
      href="/notificaciones"
      className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Notificaciones"
      prefetch={false}
    >
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute right-1.5 top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
