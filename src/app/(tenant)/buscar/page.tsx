import Link from "next/link";
import { Search, Contact, Users, FileSignature, FileText, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { searchByEntity } from "@/modules/search/full-search-actions";
import { SEARCH_PAGE_SIZE } from "@/modules/search/constants";

export const dynamic = "force-dynamic";

const ENTITY_TABS = [
  { key: "lead", label: "Leads", icon: Contact },
  { key: "customer", label: "Clientes", icon: Users },
  { key: "contract", label: "Contratos", icon: FileSignature },
  { key: "proposal", label: "Propuestas", icon: FileText },
  { key: "installation", label: "Instalaciones", icon: Wrench },
] as const;

type EntityKey = (typeof ENTITY_TABS)[number]["key"];

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; entity?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const entity: EntityKey = ENTITY_TABS.some((t) => t.key === sp.entity)
    ? (sp.entity as EntityKey)
    : "lead";
  const page = Math.max(0, parseInt(sp.page ?? "0", 10) || 0);

  const result = q.length >= 2
    ? await searchByEntity(entity, q, page).catch(() => ({ hits: [], total: 0 }))
    : { hits: [], total: 0 };
  const totalPages = Math.ceil(result.total / SEARCH_PAGE_SIZE);

  function buildHref(extra: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("entity", entity);
    Object.entries(extra).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    return `/buscar?${params.toString()}`;
  }

  const ActiveIcon = ENTITY_TABS.find((t) => t.key === entity)!.icon;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Búsqueda</h1>
        <p className="text-sm text-muted-foreground">
          Resultados completos paginados. Para búsqueda rápida usa ⌘K.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <input type="hidden" name="entity" value={entity} />
        <div className="flex-1 min-w-60 space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Buscar</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Nombre, teléfono, DNI o referencia..."
              className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Buscar
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {ENTITY_TABS.map((t) => {
          const Ic = t.icon;
          const active = entity === t.key;
          return (
            <Link
              key={t.key}
              href={`/buscar?q=${encodeURIComponent(q)}&entity=${t.key}` as never}
              className={`inline-flex h-10 items-center gap-2 rounded-xl border-2 px-4 text-sm font-semibold ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              <Ic className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ActiveIcon className="h-5 w-5 text-primary" />
            {result.total} {result.total === 1 ? "resultado" : "resultados"}
            {q && (
              <span className="text-sm font-normal text-muted-foreground">
                para &quot;{q}&quot;
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              Escribe al menos 2 caracteres para buscar.
            </p>
          ) : result.hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin resultados.</p>
          ) : (
            <ul className="space-y-2">
              {result.hits.map((h) => (
                <li
                  key={`${h.entity}-${h.id}`}
                  className="rounded-xl border border-border bg-card p-3 hover:border-primary/40"
                >
                  <Link href={h.href as never} className="block">
                    <div className="font-semibold">{h.title}</div>
                    {h.subtitle && (
                      <div className="text-xs text-muted-foreground">{h.subtitle}</div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                Página {page + 1} de {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 0 && (
                  <Link
                    href={buildHref({ page: String(page - 1) }) as never}
                    className="inline-flex h-9 items-center rounded-xl border border-border bg-card px-3 text-sm hover:bg-muted"
                  >
                    ← Anterior
                  </Link>
                )}
                {page + 1 < totalPages && (
                  <Link
                    href={buildHref({ page: String(page + 1) }) as never}
                    className="inline-flex h-9 items-center rounded-xl border border-border bg-card px-3 text-sm hover:bg-muted"
                  >
                    Siguiente →
                  </Link>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
