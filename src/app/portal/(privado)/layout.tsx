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
    <div className="min-h-[100dvh] bg-gradient-to-b from-sky-50 to-white">
      <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <a href="/portal" className="flex items-center gap-2">
            <img src="/brand/logo.svg" alt="Hidromanager" className="h-7 w-auto" />
          </a>
          <nav className="flex items-center gap-1 text-sm">
            <a href="/portal/clave" className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted">
              Contraseña
            </a>
            <a href="/portal/salir" className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted">
              Salir
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-4">
        {children}
      </main>
    </div>
  );
}
