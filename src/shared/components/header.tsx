"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, User, ChevronDown, PlayCircle, Plus, Menu } from "lucide-react";
import { ID_MENU_LATERAL, alternarMenuLateral, useMenuLateral } from "@/shared/lib/menu-lateral";
import { NotificationsBell } from "./notifications-poller";
import { GlobalSearchTrigger } from "@/modules/search/global-search";
import { replayOnboardingAction } from "@/modules/onboarding/actions";
import { TimeClockWidget } from "@/modules/time-tracking/time-clock-widget";

interface HeaderProps {
  unreadCount?: number;
  fullName?: string | null;
  email?: string | null;
  roleLabel?: string | null;
  /** Si false, oculta el TimeClockWidget — empresa sin módulo fichajes. */
  showTimeClock?: boolean;
  /** Botón «+ Lead» y enlace a Configuración (el técnico no tiene ninguno). */
  showNewLead?: boolean;
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name ?? email ?? "?").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function Header({
  unreadCount = 0,
  fullName,
  email,
  roleLabel,
  showTimeClock = true,
  showNewLead = true,
}: HeaderProps) {
  const [open, setOpen] = useState(false);
  const menuAbierto = useMenuLateral();
  const ref = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  function replayTour() {
    setOpen(false);
    startTransition(async () => {
      try {
        await replayOnboardingAction();
        try {
          window.localStorage.removeItem("onboarding.completed");
        } catch {
          /* no-op */
        }
        router.refresh();
      } catch {
        /* fail-soft */
      }
    });
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // pointerdown y no mousedown: en táctil cierra al tocar fuera sin esperar
    // al clic sintetizado.
    document.addEventListener("pointerdown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    // La Regla de la Tinta hasta el Borde: el fondo de la cabecera sube por
    // detrás de la barra de estado (pt = muesca) y la fila de controles empieza
    // debajo. 56 px en móvil, 64 en tablet, 80 en escritorio (como antes).
    <header className="marco-cabecera relative z-20 shrink-0 border-b bg-card pt-[var(--safe-top)]">
      <div className="marco-px flex h-14 items-center justify-between gap-2 [--marco-pad:0.5rem] sm:gap-3 sm:[--marco-pad:1rem] md:h-16 md:[--marco-pad:1.5rem] lg:h-20 lg:[--marco-pad:2rem]">
        <div className="flex min-w-0 flex-1 items-center gap-1 md:gap-3">
          {/* La Regla del Parabrisas: la hamburguesa vive en la cabecera, no
              flotando encima del contenido. Abre el cajón de sidebar.tsx. */}
          <button
            type="button"
            onClick={alternarMenuLateral}
            aria-label="Menú de navegación"
            aria-expanded={menuAbierto}
            aria-controls={ID_MENU_LATERAL}
            aria-haspopup="dialog"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors duration-100 hover:bg-muted active:bg-muted lg:hidden"
          >
            <Menu className="h-6 w-6" aria-hidden="true" />
          </button>
          {/* En móvil no hay carril con el logo: la marca va aquí. */}
          <Link
            href="/"
            prefetch={false}
            aria-label="Hidromanager, ir al inicio"
            className="flex shrink-0 items-center md:hidden"
          >
            <img src="/brand/logo.svg" alt="" className="h-7 w-auto" />
          </Link>
          <div className="ml-auto flex items-center md:ml-0">
            <GlobalSearchTrigger />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        {showTimeClock && <TimeClockWidget />}
        {showNewLead && (
        <Link
          href={"/leads/nuevo" as never}
          className="hidden sm:inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-primary/90"
          title="Crear lead nuevo"
        >
          <Plus className="h-4 w-4" />
          Lead
        </Link>
        )}
        <NotificationsBell initialCount={unreadCount} />
        {/* El botón suelto de salir solo cabe en escritorio; en móvil y tablet
            está en el menú de usuario y en el pie del cajón. */}
        <form action="/logout" method="post" className="hidden lg:block">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-3 text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-2xl transition-colors duration-100 hover:bg-muted active:bg-muted sm:h-auto sm:px-2 sm:py-1.5"
            aria-label="Menú de usuario"
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground sm:h-10 sm:w-10">
              {initials(fullName, email)}
            </div>
            <div className="hidden max-w-40 text-left xl:block">
              <div className="truncate text-sm font-bold leading-tight">
                {fullName ?? email ?? "Usuario"}
              </div>
              {roleLabel && (
                <div className="truncate text-xs text-muted-foreground leading-tight">{roleLabel}</div>
              )}
            </div>
            <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-card shadow-lg">
              <div className="border-b p-4">
                <div className="font-semibold">{fullName ?? "Usuario"}</div>
                <div className="text-xs text-muted-foreground">{email ?? ""}</div>
              </div>
              <div className="p-2">
                {showNewLead && (
                <a
                  href="/configuracion"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted active:bg-muted"
                  onClick={() => setOpen(false)}
                >
                  <User className="h-4 w-4" /> Configuración
                </a>
                )}
                <button
                  type="button"
                  onClick={replayTour}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted active:bg-muted"
                >
                  <PlayCircle className="h-4 w-4" /> Volver a ver el tour
                </button>
                <form action="/logout" method="post">
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-destructive hover:bg-destructive/10 active:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" /> Salir
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </header>
  );
}
