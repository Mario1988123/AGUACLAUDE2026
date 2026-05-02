/**
 * Skeleton genérico de lista — barras grises animadas para Suspense fallbacks.
 */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="h-9 w-40 animate-pulse rounded-xl bg-muted" />
      <div className="rounded-2xl border bg-card p-4">
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded-md bg-muted/70" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
