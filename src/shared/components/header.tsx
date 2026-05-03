"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User, ChevronDown, PlayCircle } from "lucide-react";
import { NotificationsBell } from "./notifications-poller";
import { GlobalSearchTrigger } from "@/modules/search/global-search";
import { replayOnboardingAction } from "@/modules/onboarding/actions";
import { TimeClockWidget } from "@/modules/time-tracking/time-clock-widget";

interface HeaderProps {
  unreadCount?: number;
  fullName?: string | null;
  email?: string | null;
  roleLabel?: string | null;
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name ?? email ?? "?").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function Header({ unreadCount = 0, fullName, email, roleLabel }: HeaderProps) {
  const [open, setOpen] = useState(false);
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
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <header className="flex h-20 items-center justify-between gap-4 border-b bg-card px-6 lg:px-8">
      <div className="ml-16 flex flex-1 items-center gap-4 lg:ml-0">
        <GlobalSearchTrigger />
      </div>

      <div className="flex items-center gap-3">
        <TimeClockWidget />
        <NotificationsBell initialCount={unreadCount} />
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 rounded-2xl px-2 py-1.5 hover:bg-muted"
            aria-label="Menú usuario"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {initials(fullName, email)}
            </div>
            <div className="hidden text-left sm:block">
              <div className="text-sm font-bold leading-tight">
                {fullName ?? email ?? "Usuario"}
              </div>
              {roleLabel && (
                <div className="text-xs text-muted-foreground leading-tight">{roleLabel}</div>
              )}
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
          {open && (
            <div className="absolute right-0 top-14 z-50 w-64 rounded-2xl border border-border bg-card shadow-lg">
              <div className="border-b p-4">
                <div className="font-semibold">{fullName ?? "Usuario"}</div>
                <div className="text-xs text-muted-foreground">{email ?? ""}</div>
              </div>
              <div className="p-2">
                <a
                  href="/configuracion"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => setOpen(false)}
                >
                  <User className="h-4 w-4" /> Configuración
                </a>
                <button
                  type="button"
                  onClick={replayTour}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted"
                >
                  <PlayCircle className="h-4 w-4" /> Volver a ver el tour
                </button>
                <form action="/logout" method="post">
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" /> Salir
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
