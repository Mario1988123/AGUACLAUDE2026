"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, List, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import {
  filtrosAParams,
  vistaEfectiva,
  type EstadoLista,
  type FiltrosLista,
} from "./catalogo-etiquetas";
import type { CategoriaFiltro } from "./catalogo-lectura";

/**
 * Filtros de la lista del maestro. Todo va a la URL (el servidor filtra y
 * pagina). Categorías en fichas siempre visibles: es la forma de navegar.
 * Móvil: buscador + «Filtros (n)» en hoja inferior. Escritorio: en una fila.
 */

const ESTADO_ETIQUETA: Record<Exclude<EstadoLista, "">, string> = {
  activos: "Activos",
  inactivos: "Inactivos",
  descatalogados: "Descatalogados",
  incompletos: "Incompletos (sin foto o sin características)",
  sin_importar: "Sin importar por nadie",
};

type Clave = "tipo" | "fab" | "cat" | "fam" | "gama" | "estado" | "q" | "agrupar" | "vista";

interface Props {
  filtros: FiltrosLista;
  categorias: CategoriaFiltro[];
  familias: { nombre: string; total: number }[];
  fabricantes: { id: string; nombre: string }[];
  gamas: { id: string; nombre: string; total: number }[];
  total: number;
  /** «productos» o «modelos» (rejilla con gamas plegadas). */
  unidad?: string;
}

const SELECT_CLS =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base md:text-sm";

function Ficha({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-100",
        activa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function Num({ n, activa }: { n: number; activa: boolean }) {
  return (
    <span
      className={cn(
        "tabular-nums text-xs font-medium",
        activa ? "text-primary-foreground/80" : "text-muted-foreground",
      )}
    >
      {n}
    </span>
  );
}

export function ListaFiltros({
  filtros,
  categorias,
  familias,
  fabricantes,
  gamas,
  total,
  unidad = "productos",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, startTransition] = useTransition();
  const [texto, setTexto] = useState(filtros.q);
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const ultimoQ = useRef(filtros.q);

  function irA(cambios: Partial<Record<Clave, string | undefined>>) {
    const actuales = filtrosAParams(filtros);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...actuales, ...cambios })) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace((qs ? `${pathname}?${qs}` : pathname) as never, { scroll: false });
    });
  }

  // Búsqueda con espera corta; se resetea la página al cambiar.
  useEffect(() => {
    const limpio = texto.trim();
    if (limpio === ultimoQ.current) return;
    const t = setTimeout(() => {
      ultimoQ.current = limpio;
      irA({ q: limpio || undefined });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const esRecambios = filtros.tipo === "recambios";
  const vista = vistaEfectiva(filtros);
  const raices = categorias
    .filter((c) => !c.padre)
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
  const catSel = categorias.find((c) => c.key === filtros.cat) ?? null;
  const raizSel = catSel ? (catSel.padre ?? catSel.key) : null;
  const subcats = raizSel ? categorias.filter((c) => c.padre === raizSel) : [];
  const totalCategorias = raices.reduce((s, c) => s + c.total, 0);
  const totalFamilias = familias.reduce((s, c) => s + c.total, 0);

  const nombreFab = fabricantes.find((m) => m.id === filtros.fab)?.nombre;
  const nombreGama = gamas.find((g) => g.id === filtros.gama)?.nombre;
  const activos: { clave: Clave; etiqueta: string }[] = [];
  if (filtros.fab) activos.push({ clave: "fab", etiqueta: `Fabricante: ${nombreFab ?? "?"}` });
  if (filtros.gama) activos.push({ clave: "gama", etiqueta: `Gama: ${nombreGama ?? "?"}` });
  if (filtros.estado) activos.push({ clave: "estado", etiqueta: ESTADO_ETIQUETA[filtros.estado] });
  if (filtros.agrupar) activos.push({ clave: "agrupar", etiqueta: "Agrupado por gama" });
  if (filtros.q) activos.push({ clave: "q", etiqueta: `«${filtros.q}»` });
  const nHoja = [filtros.fab, filtros.gama, filtros.estado].filter(Boolean).length;

  const controles = (
    <>
      <label className="block min-w-0 space-y-1">
        <span className="text-xs font-semibold text-muted-foreground md:sr-only">Fabricante</span>
        <select
          value={filtros.fab}
          onChange={(e) => irA({ fab: e.target.value || undefined })}
          className={SELECT_CLS}
        >
          <option value="">Todos los fabricantes</option>
          {fabricantes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
      </label>
      {!esRecambios && (
        <label className="block min-w-0 space-y-1">
          <span className="text-xs font-semibold text-muted-foreground md:sr-only">Gama</span>
          <select
            value={filtros.gama}
            onChange={(e) => irA({ gama: e.target.value || undefined })}
            className={SELECT_CLS}
          >
            <option value="">Todas las gamas</option>
            {gamas.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nombre} ({g.total})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block min-w-0 space-y-1">
        <span className="text-xs font-semibold text-muted-foreground md:sr-only">Estado</span>
        <select
          value={filtros.estado}
          onChange={(e) => irA({ estado: e.target.value || undefined })}
          className={SELECT_CLS}
        >
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_ETIQUETA) as Array<Exclude<EstadoLista, "">>).map((k) => (
            <option key={k} value={k}>
              {ESTADO_ETIQUETA[k]}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <div className="min-w-0 space-y-3">
      {/* Tipo */}
      <div className="grid grid-cols-3 gap-1 rounded-xl border bg-muted p-1 md:inline-grid md:w-auto">
        {(
          [
            ["equipos", "Equipos"],
            ["recambios", "Recambios"],
            ["todos", "Todos"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={filtros.tipo === v}
            onClick={() =>
              irA({
                tipo: v === "equipos" ? undefined : v,
                cat: undefined,
                fam: undefined,
                gama: undefined,
                agrupar: undefined,
              })
            }
            className={cn(
              "h-11 rounded-lg px-4 text-sm font-semibold transition-colors duration-100",
              filtros.tipo === v
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Buscador + filtros */}
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div className="flex min-w-0 gap-2 md:flex-1 md:basis-64">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Nombre, modelo o referencia…"
              aria-label="Buscar en el catálogo"
              className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-9 text-base md:text-sm"
            />
            {pendiente && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <button
            type="button"
            onClick={() => setHojaAbierta(true)}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-semibold md:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros{nHoja > 0 ? ` (${nHoja})` : ""}
          </button>
          <div className="flex shrink-0 overflow-hidden rounded-md border bg-muted" role="group" aria-label="Vista">
            <button
              type="button"
              aria-pressed={vista === "rejilla"}
              aria-label="Ver en rejilla"
              onClick={() => irA({ vista: "rejilla" })}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center",
                vista === "rejilla" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-pressed={vista === "lista"}
              aria-label="Ver en lista"
              onClick={() => irA({ vista: "lista" })}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center",
                vista === "lista" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="hidden min-w-0 gap-2 md:flex md:flex-wrap md:items-center [&>label]:w-52">
          {controles}
        </div>
      </div>

      {/* Categorías (o familias del proveedor en recambios) */}
      <nav aria-label={esRecambios ? "Familias de recambios" : "Categorías"} className="min-w-0 space-y-2">
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible">
          {esRecambios ? (
            <>
              <Ficha activa={!filtros.fam} onClick={() => irA({ fam: undefined })}>
                Todas <Num n={totalFamilias} activa={!filtros.fam} />
              </Ficha>
              {familias.map((fa) => (
                <Ficha
                  key={fa.nombre}
                  activa={filtros.fam === fa.nombre}
                  onClick={() => irA({ fam: filtros.fam === fa.nombre ? undefined : fa.nombre })}
                >
                  {fa.nombre} <Num n={fa.total} activa={filtros.fam === fa.nombre} />
                </Ficha>
              ))}
            </>
          ) : (
            <>
              <Ficha activa={!filtros.cat} onClick={() => irA({ cat: undefined })}>
                Todas <Num n={totalCategorias} activa={!filtros.cat} />
              </Ficha>
              {raices.map((c) => {
                const activa = raizSel === c.key;
                return (
                  <Ficha
                    key={c.key}
                    activa={activa}
                    onClick={() => irA({ cat: filtros.cat === c.key ? undefined : c.key })}
                  >
                    {c.nombre} <Num n={c.total} activa={activa} />
                  </Ficha>
                );
              })}
            </>
          )}
        </div>
        {subcats.length > 0 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible">
            {subcats.map((c) => {
              const activa = filtros.cat === c.key;
              return (
                <Ficha
                  key={c.key}
                  activa={activa}
                  onClick={() => irA({ cat: activa ? (raizSel ?? undefined) : c.key })}
                >
                  {c.nombre} <Num n={c.total} activa={activa} />
                </Ficha>
              );
            })}
          </div>
        )}
      </nav>

      {/* Filtros activos */}
      {activos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activos.map((a) => (
            <button
              key={a.clave}
              type="button"
              onClick={() => {
                if (a.clave === "q") {
                  ultimoQ.current = "";
                  setTexto("");
                }
                irA({ [a.clave]: undefined });
              }}
              className="inline-flex h-11 max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary/15"
              aria-label={`Quitar filtro ${a.etiqueta}`}
            >
              <span className="truncate">{a.etiqueta}</span>
              <X className="h-4 w-4 shrink-0" />
            </button>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {`${total.toLocaleString("es-ES")} ${unidad}`}
      </p>

      {/* Hoja de filtros (móvil) */}
      <Sheet open={hojaAbierta} onOpenChange={setHojaAbierta}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[calc(1rem+var(--safe-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
            <SheetDescription>Se aplican al momento.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4">{controles}</div>
          <SheetFooter>
            <button
              type="button"
              onClick={() => setHojaAbierta(false)}
              className="h-11 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground"
            >
              Ver {total.toLocaleString("es-ES")} productos
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Buscador ancho del kiosco: busca en TODO el catálogo (equipos y recambios)
 * y lleva a la lista de resultados.
 */
export function BuscadorCatalogo() {
  const router = useRouter();
  const pathname = usePathname();
  const [texto, setTexto] = useState("");
  const [pendiente, startTransition] = useTransition();
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = texto.trim();
        if (!q) return;
        const params = new URLSearchParams({ tipo: "todos", q });
        startTransition(() => router.push(`${pathname}?${params.toString()}` as never));
      }}
      className="relative"
    >
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar: referencia, modelo o nombre…"
        aria-label="Buscar en todo el catálogo"
        enterKeyHint="search"
        className="h-12 w-full rounded-full border border-input bg-card pl-12 pr-12 text-base shadow-sm"
      />
      {pendiente && (
        <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </form>
  );
}
