"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, Building2, Package, LogOut } from "lucide-react";
import { cn } from "@/shared/lib/utils";

const LG_PX = 1024;

const ITEMS = [
  { href: "/superadmin", label: "Empresas", icon: Building2, exact: true },
  { href: "/superadmin/catalogo", label: "Catálogo global", icon: Package, exact: false },
] as const;

interface Props {
  email: string | null;
  children: React.ReactNode;
}

/**
 * Shell del superadmin con sidebar responsive:
 *  - <md (móvil): hamburguesa flotante + overlay deslizante.
 *  - md-lg (tablet): sidebar permanente en modo icono (w-20).
 *  - >=lg (desktop): sidebar permanente expandido (w-60).
 */
export function SuperadminShell({ email, children }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => setIsDesktop(window.innerWidth >= LG_PX);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Cerrar overlay al cambiar de ruta
  useEffect(() => {
    if (mobileOpen) setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Bloquear scroll detrás del overlay
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Hamburguesa móvil */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-6 w-6" aria-hidden="true" />
      </button>

      {/* Sidebar permanente (tablet + desktop) */}
      <div className="hidden md:block">
        <SidebarPanel
          compact={!isDesktop}
          pathname={pathname}
          email={email}
        />
      </div>

      {/* Overlay móvil */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 h-full max-h-screen animate-in slide-in-from-left duration-200 shadow-2xl">
            <SidebarPanel
              compact={false}
              pathname={pathname}
              email={email}
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto bg-muted/20 p-3 sm:p-4 md:p-5 lg:p-6">
        {children}
      </main>
    </div>
  );
}

function SidebarPanel({
  compact,
  pathname,
  email,
  onClose,
}: {
  compact: boolean;
  pathname: string;
  email: string | null;
  onClose?: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-card transition-[width] duration-200 ease-out",
        compact ? "w-20" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b font-semibold",
          compact ? "justify-center px-2 text-base" : "justify-between px-4",
        )}
      >
        {compact ? (
          <span className="text-primary text-xl font-extrabold">A</span>
        ) : (
          <>
            <span className="text-sm tracking-tight">AGUACLAUDE · Admin</span>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted md:hidden"
                aria-label="Cerrar menú"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-2" aria-label="Navegación superadmin">
        {ITEMS.map((it) => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onClose}
              title={compact ? it.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-md text-sm font-medium transition-colors",
                compact ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {!compact && <span className="truncate">{it.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={cn("border-t", compact ? "p-2" : "p-3")}>
        {!compact && email && (
          <div className="mb-2 truncate text-xs text-muted-foreground" title={email}>
            {email}
          </div>
        )}
        <form action="/logout" method="post">
          <button
            type="submit"
            title={compact ? "Salir" : undefined}
            aria-label={compact ? "Salir" : undefined}
            className={cn(
              "flex min-h-11 w-full items-center rounded-md text-sm font-medium hover:bg-muted",
              compact ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!compact && <span>Salir</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}
