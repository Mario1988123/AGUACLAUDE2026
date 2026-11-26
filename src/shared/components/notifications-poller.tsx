"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  fetchAvisosNuevos,
  fetchUnreadCount,
  type AvisoNuevo,
} from "@/modules/notifications/actions-extra";

interface Props {
  initialCount: number;
  intervalMs?: number;
}

/** Como mucho tantos toasts sueltos por vuelta; si llegan más, uno resumen. */
const MAX_TOASTS_POR_VUELTA = 2;

/**
 * Bell con polling suave del contador de notificaciones sin leer.
 *
 * Además saca un TOAST emergente cuando llega un aviso nuevo que lo merece
 * (Mario 2026-11-26): «nueva prueba gratuita por agendar» y las alertas de
 * prioridad alta. Solo los que llegan con la app abierta (nada de golpe al
 * entrar), cada uno una sola vez, y como mucho dos por vuelta.
 */
export function NotificationsBell({ initialCount, intervalMs = 30000 }: Props) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  // Hora del servidor de la primera consulta: solo cuentan los posteriores.
  const desdeRef = useRef<string | null>(null);
  const vistosRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    function mostrar(avisos: AvisoNuevo[]) {
      const nuevos = avisos.filter((a) => !vistosRef.current.has(a.id));
      for (const a of nuevos) vistosRef.current.add(a.id);
      if (nuevos.length === 0) return;
      const abrir = (url: string | null) => () =>
        router.push((url || "/notificaciones") as never);
      if (nuevos.length > MAX_TOASTS_POR_VUELTA) {
        toast.info(`${nuevos.length} avisos nuevos`, {
          description: nuevos[0]!.title,
          duration: 10000,
          action: { label: "Ver", onClick: abrir("/notificaciones") },
        });
        return;
      }
      for (const a of nuevos) {
        const opciones = {
          description: a.body ?? undefined,
          duration: 12000,
          action: { label: "Abrir", onClick: abrir(a.action_url) },
        };
        if (a.severity === "error") toast.error(a.title, opciones);
        else if (a.severity === "warning") toast.warning(a.title, opciones);
        else toast.info(a.title, opciones);
      }
    }

    const tick = async () => {
      try {
        const [n, r] = await Promise.all([
          fetchUnreadCount(),
          fetchAvisosNuevos(desdeRef.current),
        ]);
        if (!active) return;
        setCount(n);
        if (!desdeRef.current) desdeRef.current = r.ahora;
        mostrar(r.avisos);
      } catch {
        /* silent */
      }
    };
    // Primera vuelta al montar: fija «desde» (no enseña nada antiguo).
    void tick();
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
  }, [intervalMs, router]);

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
