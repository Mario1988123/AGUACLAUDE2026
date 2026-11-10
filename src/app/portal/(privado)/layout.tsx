import type { Metadata } from "next";
import { requireSesionPortal } from "@/modules/portal-clientes/sesion";

export const metadata: Metadata = {
  title: "Área de clientes",
  robots: { index: false, follow: false },
};

// Siempre dinámico: depende de la sesión del cliente.
export const dynamic = "force-dynamic";

export default async function PortalPrivadoLayout({ children }: { children: React.ReactNode }) {
  await requireSesionPortal();
  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-white">
      <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur pt-[var(--safe-top)]">
        <div className="marco-px mx-auto flex h-14 max-w-2xl items-center justify-between [--marco-pad:1rem]">
          <a href="/portal" className="flex items-center gap-2">
            <img src="/brand/logo.svg" alt="Hidromanager" className="h-7 w-auto" />
          </a>
          <nav className="flex items-center gap-1 text-sm">
            <a href="/portal/clave" className="flex min-h-11 items-center rounded-md px-3 text-muted-foreground transition-colors duration-100 hover:bg-muted active:bg-muted">
              Contraseña
            </a>
            <a href="/portal/salir" className="flex min-h-11 items-center rounded-md px-3 text-muted-foreground transition-colors duration-100 hover:bg-muted active:bg-muted">
              Salir
            </a>
          </nav>
        </div>
      </header>
      <main className="marco-px mx-auto max-w-2xl pb-[calc(2rem+var(--safe-bottom))] pt-4 [--marco-pad:1rem]">
        {children}
      </main>
    </div>
  );
}
