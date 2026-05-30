import * as React from "react";
import { Inbox, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface BaseProps {
  className?: string;
}

interface EmptyStateProps extends BaseProps {
  /** Título corto del estado vacío. */
  title: string;
  /** Descripción 1-2 líneas. */
  description?: string;
  /** Acción CTA opcional (ej. botón "Nuevo lead"). */
  action?: React.ReactNode;
  /** Icono personalizado. Por defecto Inbox. */
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Estado vacío estándar (no hay datos aún). Sustituye al típico
 * `<p>No hay registros</p>` con un layout más amable y con CTA cuando aplica.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-center sm:p-8",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground sm:text-balance">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

interface ErrorStateProps extends BaseProps {
  /** Título corto del error. */
  title?: string;
  /** Mensaje legible para el usuario (no stack trace). */
  description?: string;
  /** Acción de recuperación (ej. botón "Reintentar"). */
  action?: React.ReactNode;
}

/**
 * Estado de error consistente. Pensado para mostrar dentro de un area de
 * contenido cuando una query falla. No usar como pantalla completa.
 */
export function ErrorState({
  title = "No hemos podido cargar esta información",
  description = "Reintenta en unos segundos. Si el problema persiste, avisa al administrador.",
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:gap-4",
        className,
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold text-destructive">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface LoadingStateProps extends BaseProps {
  /** Texto opcional debajo del spinner. */
  label?: string;
  /** Tamaño del spinner: sm para áreas pequeñas, md (default), lg para pantalla. */
  size?: "sm" | "md" | "lg";
}

/**
 * Estado de carga con spinner centrado + texto opcional. Para áreas pequeñas
 * (inline) preferir el componente Spinner directamente. Para listados largos
 * preferir <Skeleton />.
 */
export function LoadingState({
  label = "Cargando...",
  size = "md",
  className,
}: LoadingStateProps) {
  const sizes = {
    sm: { spinner: "h-4 w-4", text: "text-xs", padding: "p-3" },
    md: { spinner: "h-6 w-6", text: "text-sm", padding: "p-6" },
    lg: { spinner: "h-8 w-8", text: "text-base", padding: "p-10" },
  } as const;
  const s = sizes[size];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-muted-foreground",
        s.padding,
        className,
      )}
    >
      <Loader2 className={cn(s.spinner, "animate-spin")} aria-hidden="true" />
      <p className={s.text}>{label}</p>
    </div>
  );
}
