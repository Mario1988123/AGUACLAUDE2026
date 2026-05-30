import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  /** Título principal de la página. */
  title: React.ReactNode;
  /** Subtítulo o descripción corta (1 línea). */
  subtitle?: React.ReactNode;
  /** Si se pasa, muestra una flecha "atrás" a la izquierda del título. */
  backHref?: string;
  /** Etiqueta del botón "atrás" — accesibilidad y tooltip. */
  backLabel?: string;
  /** Breadcrumb opcional (4-5 niveles max). */
  breadcrumb?: BreadcrumbItem[];
  /** Acciones a la derecha del header (botones, links). En móvil se apilan abajo. */
  actions?: React.ReactNode;
  /** Badges/chips al lado del título (ej. estado, contador). */
  badges?: React.ReactNode;
  /** Clase extra para el contenedor. */
  className?: string;
}

/**
 * Cabecera estándar de página. Resuelve el patrón típico:
 *  - Móvil (<sm): título arriba, acciones apiladas debajo (full-width opcional).
 *  - Tablet (sm-lg): título a la izq, acciones a la dr con wrap.
 *  - Desktop (>=lg): mismo, con más aire.
 *
 * Uso típico en una página:
 * ```tsx
 * <PageHeader
 *   backHref="/clientes"
 *   title="Juan Pérez"
 *   subtitle="Cliente desde marzo 2024"
 *   badges={<Badge>Activo</Badge>}
 *   actions={<Button>Nueva propuesta</Button>}
 * />
 * ```
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel = "Volver",
  breadcrumb,
  actions,
  badges,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Migas de pan" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {breadcrumb.map((item, idx) => {
                const isLast = idx === breadcrumb.length - 1;
                return (
                  <li key={`${item.label}-${idx}`} className="flex items-center gap-1">
                    {item.href && !isLast ? (
                      <Link
                        href={item.href as never}
                        className="rounded px-1 py-0.5 hover:bg-muted hover:text-foreground"
                        data-compact
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <span className={cn("px-1 py-0.5", isLast && "font-medium text-foreground")}>
                        {item.label}
                      </span>
                    )}
                    {!isLast && <span aria-hidden="true">/</span>}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {backHref && (
            <Link
              href={backHref as never}
              aria-label={backLabel}
              title={backLabel}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              data-compact
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <h1 className="min-w-0 truncate text-xl font-bold tracking-tight sm:text-2xl">
            {title}
          </h1>
          {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
        </div>

        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground sm:mt-1.5">{subtitle}</p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
}
