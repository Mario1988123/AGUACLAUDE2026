"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Layout para todas las rutas /configuracion/*. En la página raíz no muestra
 * nada extra. En subrutas (fiscal, mailing, leads, etc.) añade un botón
 * "Volver a configuración" arriba para que el admin no tenga que navegar
 * con el sidebar/breadcrumb. Decisión usuario 2026-05-11.
 */
export default function ConfiguracionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isRoot = pathname === "/configuracion";
  return (
    <div className="space-y-4">
      {!isRoot && (
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a configuración
        </Link>
      )}
      {children}
    </div>
  );
}
