import * as React from "react";
import { cn } from "@/shared/lib/utils";

interface ResponsiveTableWrapperProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Si true, muestra un degradado a la derecha cuando hay scroll horizontal
   * disponible (pista visual de que hay más contenido).
   */
  showScrollHint?: boolean;
  /** Etiqueta accesible si la tabla representa datos críticos. */
  ariaLabel?: string;
}

/**
 * Envoltorio para tablas que asegura scroll horizontal en pantallas estrechas
 * sin romper el layout. Resuelve el patrón:
 *  - Tablet/desktop: tabla normal con scroll horizontal si hace falta.
 *  - Móvil: idealmente se sustituye por cards, pero si no hay alternativa,
 *    al menos scroll lateral con `-webkit-overflow-scrolling: touch`.
 *
 * Uso típico (tabla en desktop, cards en móvil):
 * ```tsx
 * <div className="hidden md:block">
 *   <ResponsiveTableWrapper>
 *     <table>...</table>
 *   </ResponsiveTableWrapper>
 * </div>
 * <div className="md:hidden flex flex-col gap-2">
 *   {rows.map(r => <RowCard key={r.id} {...r} />)}
 * </div>
 * ```
 */
export function ResponsiveTableWrapper({
  children,
  className,
  showScrollHint = false,
  ariaLabel,
}: ResponsiveTableWrapperProps) {
  return (
    <div
      role={ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
      tabIndex={ariaLabel ? 0 : undefined}
      className={cn(
        "relative overflow-x-auto rounded-lg border border-border bg-card",
        "[-webkit-overflow-scrolling:touch]",
        showScrollHint &&
          "after:pointer-events-none after:absolute after:right-0 after:top-0 after:h-full after:w-8 after:bg-gradient-to-l after:from-card after:to-transparent",
        className,
      )}
    >
      {children}
    </div>
  );
}
