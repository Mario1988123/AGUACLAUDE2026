"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import * as Icons from "lucide-react";
import { cn } from "@/shared/lib/utils";

export interface BottomNavItem {
  key: string;
  label: string;
  icon: string;
  href: string;
}

interface Props {
  /** Cuenta de notificaciones sin leer (badge en el icono "Avisos"). */
  unreadCount?: number;
  /**
   * Lista de módulos a los que el usuario tiene acceso (resuelto en el server
   * por roles + módulos activos de la empresa). Se usa para validar que las
   * preferencias guardadas siguen siendo accesibles tras un cambio de rol.
   */
  availableItems: BottomNavItem[];
}

/** Default si el usuario aún no ha personalizado. Mismo orden histórico. */
const DEFAULT_KEYS = ["dashboard", "my_day", "installations", "leads", "notifications"] as const;

const STORAGE_KEY = "bottom-nav.modules.v1";

/** Pseudo-módulo "Notificaciones" — siempre disponible, lleva badge. */
const NOTIFICATIONS_ITEM: BottomNavItem = {
  key: "notifications",
  label: "Avisos",
  icon: "Bell",
  href: "/notificaciones",
};

/**
 * Bottom navigation para móvil. Scroll horizontal con snap, configurable
 * por el usuario desde /configuracion/menu-movil (preferencia en localStorage).
 * Sólo visible en pantallas <md (en tablet ya hay sidebar permanente icono).
 */
export function BottomNav({ unreadCount = 0, availableItems }: Props) {
  const pathname = usePathname();
  const [pinnedKeys, setPinnedKeys] = useState<readonly string[]>(DEFAULT_KEYS);
  const [hydrated, setHydrated] = useState(false);

  // Mapa de keys disponibles para validar la preferencia guardada
  const lookup = useMemo(() => {
    const map = new Map<string, BottomNavItem>();
    map.set(NOTIFICATIONS_ITEM.key, NOTIFICATIONS_ITEM);
    for (const it of availableItems) map.set(it.key, it);
    return map;
  }, [availableItems]);

  // Cargar preferencia desde localStorage + escuchar cambios (cuando el usuario
  // edita en /configuracion/menu-movil queremos actualizar sin recargar).
  useEffect(() => {
    if (typeof window === "undefined") return;
    function load() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          setPinnedKeys(DEFAULT_KEYS);
          setHydrated(true);
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter(
            (k) => typeof k === "string",
          ) as string[];
          setPinnedKeys(valid);
        }
        setHydrated(true);
      } catch {
        setPinnedKeys(DEFAULT_KEYS);
        setHydrated(true);
      }
    }
    load();
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) load();
    }
    function onCustom() {
      load();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("bottom-nav-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bottom-nav-changed", onCustom);
    };
  }, []);

  // Filtrar keys válidas (las que existen para este usuario), respetar el
  // orden guardado. Si tras filtrar queda vacío, caer en default.
  const items = useMemo(() => {
    const filtered = pinnedKeys
      .map((k) => lookup.get(k))
      .filter((x): x is BottomNavItem => Boolean(x));
    if (filtered.length === 0) {
      return DEFAULT_KEYS
        .map((k) => lookup.get(k))
        .filter((x): x is BottomNavItem => Boolean(x));
    }
    return filtered;
  }, [pinnedKeys, lookup]);

  // Evitar parpadeo durante hidratación: hasta que sepamos qué pintar,
  // pintamos los defaults. (SSR ve defaults; cliente puede ver custom).
  void hydrated;

  return (
    <nav
      aria-label="Navegación principal móvil"
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div
        className="scrollbar-none flex snap-x snap-mandatory items-stretch gap-1 overflow-x-auto px-2 py-1"
        style={{ scrollbarWidth: "none" }}
      >
        {items.map((it) => {
          const Icon =
            (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
              it.icon
            ] ?? Icons.Square;
          const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
          const isNotifications = it.key === "notifications";
          const badge = isNotifications ? unreadCount : 0;
          const ariaLabel =
            isNotifications && badge > 0
              ? `${it.label}, ${badge} ${badge === 1 ? "sin leer" : "sin leer"}`
              : it.label;
          return (
            <Link
              key={it.key}
              href={it.href as never}
              prefetch={false}
              aria-label={ariaLabel}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-w-[4.5rem] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold leading-none">{it.label}</span>
              {badge > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-2 top-0.5 flex h-4 min-w-[1.1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground"
                >
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </Link>
          );
        })}
        {/* Botón fijo "Editar" al final del scroll — entra a la página de
            configuración del menú móvil. */}
        <Link
          href={"/configuracion/menu-movil" as never}
          prefetch={false}
          aria-label="Editar menú móvil — elegir qué iconos aparecen aquí"
          className="relative flex min-w-[4.5rem] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border px-2 py-1.5 text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          <Icons.SlidersHorizontal className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="text-[11px] font-semibold leading-none">Editar</span>
        </Link>
      </div>
    </nav>
  );
}

export function BottomNavSpacer() {
  return <div className="h-16 md:hidden" aria-hidden="true" />;
}
