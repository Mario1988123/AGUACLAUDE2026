import { listProductFilters } from "@/modules/products/filters-actions";
import { FiltersListClient } from "@/modules/products/filters-list-client";
import { isProductEditor } from "@/modules/products/permissions";
import { requireSession } from "@/shared/lib/auth/session";
import { BackButton } from "@/shared/components/back-button";
import { getFilterStockPredictions } from "@/modules/products/filter-stock-predictions";

export const dynamic = "force-dynamic";

export default async function FiltersPage() {
  const session = await requireSession();
  const canEdit = isProductEditor(session);
  const [filters, predictions] = await Promise.all([
    listProductFilters({ active_only: false }),
    getFilterStockPredictions().catch(() => []),
  ]);

  const critical = predictions.filter((p) => p.severity === "critical");
  const warning = predictions.filter((p) => p.severity === "warning");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Filtros y recambios</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de filtros consumibles (separados de los equipos).
            Se asignan a uno o varios equipos y se usan en los mantenimientos.
          </p>
        </div>
        <BackButton href="/productos" />
      </div>

      {(critical.length > 0 || warning.length > 0) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-bold text-amber-900">
            🧠 Stock predictivo (próximos 90 días)
          </h3>
          <ul className="space-y-1.5 text-xs">
            {critical.concat(warning).slice(0, 10).map((p) => (
              <li
                key={p.filter_id}
                className="flex flex-wrap items-center gap-2"
              >
                <span
                  className={
                    p.severity === "critical"
                      ? "rounded-full bg-red-600 px-2 py-0.5 text-white"
                      : "rounded-full bg-amber-500 px-2 py-0.5 text-white"
                  }
                >
                  {p.severity === "critical" ? "Crítico" : "Aviso"}
                </span>
                <span className="font-semibold">{p.filter_name}</span>
                <span className="text-amber-900">
                  Demanda esperada {p.expected_demand_next_90d} · Stock {p.current_stock}
                  {p.compatible_stock > 0 && ` (+${p.compatible_stock} compatibles)`}
                  {p.shortage > 0 && ` · Faltan ${p.shortage}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FiltersListClient filters={filters} canEdit={canEdit} />
    </div>
  );
}
