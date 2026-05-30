import * as React from "react";
import { cn } from "@/shared/lib/utils";

interface FormGridProps {
  children: React.ReactNode;
  /**
   * Columnas en desktop. En móvil siempre 1, en tablet (sm) la mitad redondeando hacia abajo.
   * - 1 → 1 col en todos los tamaños
   * - 2 → 1 móvil, 2 desde sm
   * - 3 → 1 móvil, 2 sm, 3 lg
   * - 4 → 1 móvil, 2 sm, 4 lg
   */
  cols?: 1 | 2 | 3 | 4;
  /** Gap entre hijos. */
  gap?: "sm" | "md" | "lg";
  className?: string;
}

const COL_CLASSES: Record<NonNullable<FormGridProps["cols"]>, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

const GAP_CLASSES: Record<NonNullable<FormGridProps["gap"]>, string> = {
  sm: "gap-2 sm:gap-3",
  md: "gap-3 sm:gap-4",
  lg: "gap-4 sm:gap-6",
};

/**
 * Grid responsive estándar para formularios y KPIs. Garantiza que en móvil
 * sea 1 columna y que escale ordenadamente. Evita el bug típico de
 * `sm:grid-cols-2 lg:grid-cols-4` sin `grid-cols-1` explícito.
 *
 * Uso:
 * ```tsx
 * <FormGrid cols={2} gap="md">
 *   <Field><Label>Nombre</Label><Input /></Field>
 *   <Field><Label>Email</Label><Input /></Field>
 * </FormGrid>
 * ```
 */
export function FormGrid({ children, cols = 2, gap = "md", className }: FormGridProps) {
  return (
    <div className={cn("grid", COL_CLASSES[cols], GAP_CLASSES[gap], className)}>
      {children}
    </div>
  );
}

/**
 * Wrapper para un campo de formulario. Combina label + input + helper/error
 * con espaciado consistente. Opcional — los formularios pueden seguir
 * componiendo a mano si necesitan layouts especiales.
 */
export function Field({
  children,
  className,
  /** Si true, el field ocupa 2 columnas en el grid (full-width). */
  span2,
}: {
  children: React.ReactNode;
  className?: string;
  span2?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", span2 && "sm:col-span-2", className)}>
      {children}
    </div>
  );
}
