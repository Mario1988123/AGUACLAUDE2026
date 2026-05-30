import * as React from "react";
import { cn } from "@/shared/lib/utils";

interface FilterBarProps {
  children: React.ReactNode;
  /** Si true, los hijos se apilan en vertical en móvil (recomendado para 3+ filtros). */
  stackOnMobile?: boolean;
  /** Clase extra para el form/contenedor. */
  className?: string;
  /** Etiqueta accesible. */
  ariaLabel?: string;
  /**
   * Si se pasa, los hijos se envuelven en un <form action={...}>. Si no,
   * se renderiza como <div> (útil cuando los filtros son botones-link).
   */
  formAction?: string;
}

/**
 * Contenedor estándar para barras de filtros y búsqueda en listados.
 * Resuelve el patrón típico:
 *  - Móvil: stack vertical (cada filtro full-width) si stackOnMobile=true.
 *  - Tablet+: flex-wrap con gap, cada filtro mantiene su tamaño natural.
 *
 * Uso típico:
 * ```tsx
 * <FilterBar formAction="/leads" stackOnMobile>
 *   <SearchInput name="q" />
 *   <Select name="status">...</Select>
 *   <DateRange />
 *   <Button type="submit">Filtrar</Button>
 * </FilterBar>
 * ```
 */
export function FilterBar({
  children,
  stackOnMobile = false,
  className,
  ariaLabel,
  formAction,
}: FilterBarProps) {
  const containerClass = cn(
    "rounded-lg border border-border bg-card p-3 sm:p-4",
    "flex flex-wrap items-stretch gap-2 sm:gap-3",
    stackOnMobile && "flex-col sm:flex-row",
    className,
  );

  const content = (
    <FilterBarContext.Provider value={{ stackOnMobile }}>
      {children}
    </FilterBarContext.Provider>
  );

  if (formAction) {
    return (
      <form
        action={formAction}
        method="get"
        role="search"
        aria-label={ariaLabel}
        className={containerClass}
      >
        {content}
      </form>
    );
  }

  return (
    <div role="toolbar" aria-label={ariaLabel} className={containerClass}>
      {content}
    </div>
  );
}

const FilterBarContext = React.createContext<{ stackOnMobile: boolean }>({
  stackOnMobile: false,
});

/**
 * Envoltorio opcional para cada filtro. Aplica un min-width consistente y
 * grow controlado para que los filtros no queden raquíticos en desktop.
 */
export function FilterField({
  children,
  grow = false,
  minWidth = 160,
  className,
}: {
  children: React.ReactNode;
  /** Si true, el campo crece a ocupar el espacio disponible (útil para búsqueda). */
  grow?: boolean;
  /** Ancho mínimo en desktop (en px). Default 160. */
  minWidth?: number;
  className?: string;
}) {
  const ctx = React.useContext(FilterBarContext);
  return (
    <div
      className={cn(
        ctx.stackOnMobile ? "w-full sm:w-auto" : "min-w-0",
        grow && "sm:flex-1",
        className,
      )}
      style={{ minWidth: ctx.stackOnMobile ? undefined : minWidth }}
    >
      {children}
    </div>
  );
}
