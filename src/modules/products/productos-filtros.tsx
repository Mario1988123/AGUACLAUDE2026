"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, List, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { filtrosEmpresaAParams, type FiltrosListaEmpresa } from "./productos-vista";

/**
 * Buscador y filtros de la lista de productos de la empresa (mismo patrón que
 * la del maestro). Todo va a la URL y se aplica al tocar, sin botón «Aplicar».
 * Móvil: buscador + «Filtros (n)» en hoja inferior y los activos como fichas que
 * se quitan con un toque. Escritorio: fichas en una fila.
 */

type Clave = keyof ReturnType<typeof filtrosEmpresaAParams>;

const TIPOS: Array<[string, string]> = [
  ["equipment", "Equipos"],
  ["accessory", "Accesorios"],
  ["consumable", "Consumibles"],
  ["spare_part", "Recambios"],
  ["service", "Servicios"],
];

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

export function ProductosFiltros({
  filtros,
  canEdit,
  tags,
  total,
  unidad = "productos",
}: {
  filtros: FiltrosListaEmpresa;
  canEdit: boolean;
  tags: string[];
  total: number;
  unidad?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, startTransition] = useTransition();
  const [texto, setTexto] = useState(filtros.q);
  const [hoja, setHoja] = useState(false);
  const ultimoQ = useRef(filtros.q);

  function irA(cambios: Partial<Record<Clave, string | undefined>>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filtrosEmpresaAParams(filtros), ...cambios })) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => router.replace((qs ? `${pathname}?${qs}` : pathname) as never, { scroll: false }));
  }

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

  const alternar = (clave: Clave, valor: string, actual: string | boolean) =>
    irA({ [clave]: actual === valor || actual === true ? undefined : valor });

  const activos: Array<{ clave: Clave; etiqueta: string }> = [];
  if (filtros.tipo) activos.push({ clave: "tipo", etiqueta: TIPOS.find((t) => t[0] === filtros.tipo)?.[1] ?? filtros.tipo });
  if (filtros.estado) activos.push({ clave: "estado", etiqueta: filtros.estado === "activos" ? "Activos" : "Inactivos" });
  if (filtros.tag) activos.push({ clave: "tag", etiqueta: `Etiqueta: ${filtros.tag}` });
  if (filtros.sinPrecio) activos.push({ clave: "sinprecio", etiqueta: "Sin precio" });
  if (filtros.sinFoto) activos.push({ clave: "sinfoto", etiqueta: "Sin foto" });
  if (filtros.conActualizacion) activos.push({ clave: "actualizacion", etiqueta: "Con actualización" });

  const vista = filtros.vista === "lista" || filtros.vista === "rejilla" ? filtros.vista : "";

  const fichas = (
    <>
      {TIPOS.map(([v, l]) => (
        <Ficha key={v} activa={filtros.tipo === v} onClick={() => alternar("tipo", v, filtros.tipo)}>
          {l}
        </Ficha>
      ))}
      <Ficha activa={filtros.estado === "activos"} onClick={() => alternar("estado", "activos", filtros.estado)}>
        Activos
      </Ficha>
      <Ficha activa={filtros.estado === "inactivos"} onClick={() => alternar("estado", "inactivos", filtros.estado)}>
        Inactivos
      </Ficha>
      {canEdit && (
        <>
          <Ficha activa={filtros.sinPrecio} onClick={() => alternar("sinprecio", "1", filtros.sinPrecio)}>
            Sin precio
          </Ficha>
          <Ficha activa={filtros.sinFoto} onClick={() => alternar("sinfoto", "1", filtros.sinFoto)}>
            Sin foto
          </Ficha>
          <Ficha
            activa={filtros.conActualizacion}
            onClick={() => alternar("actualizacion", "1", filtros.conActualizacion)}
          >
            Con actualización
          </Ficha>
        </>
      )}
      {tags.length > 0 && (
        <label className="inline-flex shrink-0 items-center">
          <span className="sr-only">Etiqueta</span>
          <select
            value={filtros.tag}
            onChange={(e) => irA({ tag: e.target.value || undefined })}
            className="h-11 rounded-full border border-input bg-card px-4 text-base md:text-sm"
          >
            <option value="">Todas las etiquetas</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar productos</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar: nombre o referencia…"
            enterKeyHint="search"
            className="h-12 w-full rounded-full border border-input bg-card pl-12 pr-10 text-base shadow-sm"
          />
          {pendiente && (
            <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </label>
        <button
          type="button"
          onClick={() => setHoja(true)}
          className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold hover:bg-muted lg:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtros{activos.length > 0 ? ` (${activos.length})` : ""}
        </button>
      </div>

      <div className="hidden flex-wrap gap-2 lg:flex">{fichas}</div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:hidden">
          {activos.map((a) => (
            <button
              key={a.clave}
              type="button"
              onClick={() => irA({ [a.clave]: undefined })}
              className="inline-flex h-9 items-center gap-1 rounded-full bg-muted px-3 text-sm font-medium"
              aria-label={`Quitar filtro ${a.etiqueta}`}
            >
              {a.etiqueta} <X className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {total.toLocaleString("es-ES")} {unidad}
        </span>
        <div className="ml-auto flex rounded-xl border bg-card p-0.5" role="group" aria-label="Vista">
          <button
            type="button"
            onClick={() => irA({ vista: "lista" })}
            aria-pressed={vista === "lista"}
            className={cn(
              "inline-flex h-10 w-11 items-center justify-center rounded-lg",
              vista === "lista" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
            aria-label="Ver en filas"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => irA({ vista: "rejilla" })}
            aria-pressed={vista === "rejilla"}
            className={cn(
              "inline-flex h-10 w-11 items-center justify-center rounded-lg",
              vista === "rejilla" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
            aria-label="Ver en rejilla"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Sheet open={hoja} onOpenChange={setHoja}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom))]">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
            <SheetDescription>Se aplican al tocarlos.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-wrap gap-2 px-4 pb-4">{fichas}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
