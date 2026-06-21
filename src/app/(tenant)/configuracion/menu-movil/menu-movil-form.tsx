"use client";

import { useEffect, useMemo, useState } from "react";
import * as Icons from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { cn } from "@/shared/lib/utils";

interface Item {
  key: string;
  label: string;
  icon: string;
  href: string;
}

interface Props {
  availableItems: Item[];
  /** Iconos por defecto según el rol (lo calcula el server). */
  defaultKeys?: string[];
}

const STORAGE_KEY = "bottom-nav.modules.v1";
const DEFAULT_KEYS = ["dashboard", "my_day", "installations", "leads", "notifications"];
const NOTIFICATIONS_ITEM: Item = {
  key: "notifications",
  label: "Avisos",
  icon: "Bell",
  href: "/notificaciones",
};

/**
 * Formulario para que cada usuario decida qué iconos aparecen en el BottomNav
 * móvil y en qué orden. Persistencia en localStorage (preferencia del
 * dispositivo, no por usuario en BD — es como los iconos del escritorio del
 * móvil: el usuario los ordena en cada dispositivo).
 */
export function MenuMovilForm({ availableItems, defaultKeys }: Props) {
  const effectiveDefaults = useMemo(
    () => (defaultKeys && defaultKeys.length > 0 ? defaultKeys : DEFAULT_KEYS),
    [defaultKeys],
  );
  // Mapa de keys disponibles + notificaciones siempre
  const lookup = useMemo(() => {
    const m = new Map<string, Item>();
    m.set(NOTIFICATIONS_ITEM.key, NOTIFICATIONS_ITEM);
    for (const it of availableItems) m.set(it.key, it);
    return m;
  }, [availableItems]);

  // Lista total ordenada que el usuario manipula
  const [order, setOrder] = useState<string[]>([]);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  // Carga inicial desde localStorage o default
  useEffect(() => {
    let savedKeys: string[] | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) savedKeys = parsed.filter((k) => typeof k === "string");
      }
    } catch {
      /* */
    }

    const allKeys = Array.from(lookup.keys());
    if (savedKeys && savedKeys.length > 0) {
      // Orden = guardadas primero (filtradas por accesibles) + resto al final
      const validSaved = savedKeys.filter((k) => lookup.has(k));
      const rest = allKeys.filter((k) => !validSaved.includes(k));
      setOrder([...validSaved, ...rest]);
      setPinned(new Set(validSaved));
    } else {
      // Default por rol + el resto detrás
      const defaults = effectiveDefaults.filter((k) => lookup.has(k));
      const rest = allKeys.filter((k) => !defaults.includes(k));
      setOrder([...defaults, ...rest]);
      setPinned(new Set(defaults));
    }
  }, [lookup, effectiveDefaults]);

  function togglePin(key: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setDirty(true);
  }

  function move(key: string, dir: -1 | 1) {
    setOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
      return next;
    });
    setDirty(true);
  }

  function save() {
    // Guardar solo los pineados, respetando el orden actual
    const toSave = order.filter((k) => pinned.has(k));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      // Avisar al BottomNav (mismo tab — el evento storage no se dispara en mismo tab)
      window.dispatchEvent(new Event("bottom-nav-changed"));
      notify.success("Menú guardado", "Los cambios se aplican al instante.");
      setDirty(false);
    } catch {
      notify.error("Error", "No se pudo guardar. Comprueba el almacenamiento del navegador.");
    }
  }

  function reset() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event("bottom-nav-changed"));
    } catch {
      /* */
    }
    const allKeys = Array.from(lookup.keys());
    const defaults = effectiveDefaults.filter((k) => lookup.has(k));
    const rest = allKeys.filter((k) => !defaults.includes(k));
    setOrder([...defaults, ...rest]);
    setPinned(new Set(defaults));
    setDirty(false);
    notify.success("Menú restablecido", "Volviste al menú por defecto.");
  }

  const pinnedCount = pinned.size;
  const visibleSelectedItems = order.filter((k) => pinned.has(k)).map((k) => lookup.get(k)!);

  return (
    <div className="space-y-5">
      {/* Vista previa rápida arriba — el usuario ve cómo le va a quedar */}
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Vista previa
        </div>
        {visibleSelectedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No has elegido ningún icono — el menú móvil aparecerá vacío. Marca al menos
            uno.
          </p>
        ) : (
          <div className="scrollbar-none flex gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {visibleSelectedItems.map((it) => {
              const Icon =
                (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
                  it.icon
                ] ?? Icons.Square;
              return (
                <div
                  key={it.key}
                  className="flex min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border bg-card px-2 py-1.5 text-muted-foreground"
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="text-[11px] font-semibold leading-none">{it.label}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {pinnedCount} icono{pinnedCount === 1 ? "" : "s"} elegido
          {pinnedCount === 1 ? "" : "s"}. En el móvil se mostrarán con scroll horizontal
          si no caben todos.
        </p>
      </div>

      {/* Lista de todos los módulos accesibles con checkbox + reorder */}
      <ul className="divide-y rounded-xl border">
        {order.map((key, idx) => {
          const it = lookup.get(key);
          if (!it) return null;
          const Icon =
            (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
              it.icon
            ] ?? Icons.Square;
          const isPinned = pinned.has(key);
          return (
            <li
              key={key}
              className={cn(
                "flex items-center gap-3 p-3 transition-colors",
                isPinned ? "bg-primary/5" : "bg-card",
              )}
            >
              <label className="flex flex-1 cursor-pointer items-center gap-3 min-w-0">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={() => togglePin(key)}
                  aria-label={`Mostrar ${it.label} en el menú móvil`}
                  className="h-5 w-5 shrink-0"
                  data-inline
                />
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                    isPinned ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{it.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{it.href}</div>
                </div>
              </label>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(key, -1)}
                  disabled={idx === 0}
                  aria-label={`Subir ${it.label}`}
                  data-compact
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <Icons.ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => move(key, 1)}
                  disabled={idx === order.length - 1}
                  aria-label={`Bajar ${it.label}`}
                  data-compact
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <Icons.ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={reset}
          className="w-full sm:w-auto"
        >
          <Icons.RotateCcw className="h-4 w-4" aria-hidden="true" />
          Restablecer por defecto
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={!dirty}
          variant="success"
          className="w-full sm:w-auto"
        >
          <Icons.Save className="h-4 w-4" aria-hidden="true" />
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
