import Link from "next/link";

interface Props {
  basePath: string;
  page: number;
  pageSize: number;
  totalCount?: number;
  hasMore?: boolean;
  /** Otros searchParams a preservar (filtros). */
  preserveParams?: Record<string, string | undefined>;
}

/**
 * Componente simple de paginación con enlaces ←/→ y "página N de M".
 * Server-rendered: cambia el ?page=N en la URL conservando el resto de
 * filtros. Para usar pásale page y pageSize, y opcionalmente totalCount
 * (para mostrar páginas totales) o hasMore (si no conoces el total).
 */
export function Pagination({
  basePath,
  page,
  pageSize,
  totalCount,
  hasMore,
  preserveParams,
}: Props) {
  const totalPages = totalCount
    ? Math.max(1, Math.ceil(totalCount / pageSize))
    : null;

  function buildHref(p: number): string {
    const params = new URLSearchParams();
    if (preserveParams) {
      for (const [k, v] of Object.entries(preserveParams)) {
        if (v) params.set(k, v);
      }
    }
    if (p > 1) params.set("page", String(p));
    const q = params.toString();
    return q ? `${basePath}?${q}` : basePath;
  }

  const hasNext = totalPages != null ? page < totalPages : !!hasMore;
  const hasPrev = page > 1;

  if (!hasNext && !hasPrev) return null;

  return (
    <div className="flex items-center justify-center gap-3 py-2">
      {hasPrev ? (
        <Link
          href={buildHref(page - 1) as never}
          className="inline-flex h-9 items-center rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          ← Anterior
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center rounded-xl border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
          ← Anterior
        </span>
      )}
      <span className="text-sm font-bold tabular-nums">
        {totalPages ? `${page} / ${totalPages}` : `Página ${page}`}
      </span>
      {hasNext ? (
        <Link
          href={buildHref(page + 1) as never}
          className="inline-flex h-9 items-center rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          Siguiente →
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center rounded-xl border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
          Siguiente →
        </span>
      )}
    </div>
  );
}
