"use client";

import { useState } from "react";
import Link from "next/link";
import { Droplets, Package, Wrench } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import type { ProductoMini } from "./catalogo-lectura";
import { KIND_ETIQUETA } from "./catalogo-etiquetas";

/**
 * Consumibles y repuestos de un equipo (con las proyecciones arriba si las
 * hay), o, en un recambio, la lista inversa: «Se usa en». Solo lectura.
 */

export interface ProyeccionVista {
  id: string;
  etiqueta: string | null;
  url: string | null;
  miniatura: string | null;
}

type Filtro = "todos" | "consumable" | "spare_part";

function Icono({ kind }: { kind: string }) {
  if (kind === "consumable") return <Droplets className="h-5 w-5" aria-hidden="true" />;
  if (kind === "spare_part") return <Wrench className="h-5 w-5" aria-hidden="true" />;
  return <Package className="h-5 w-5" aria-hidden="true" />;
}

function Fila({ p, mostrarTipo }: { p: ProductoMini; mostrarTipo: boolean }) {
  return (
    <li>
      <Link
        href={`/superadmin/catalogo/productos/${p.id}` as never}
        className="flex min-h-14 items-center gap-3 rounded-lg px-1 py-1.5 transition-colors duration-100 hover:bg-muted/50"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
          {p.miniatura ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.miniatura} alt="" loading="lazy" className="h-full w-full object-contain p-0.5" />
          ) : (
            <Icono kind={p.kind} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-xs font-semibold">{p.ref}</span>
            {mostrarTipo && (
              <Badge variant={p.kind === "consumable" ? "default" : "secondary"} className="px-2 py-0.5 text-[11px]">
                {KIND_ETIQUETA[p.kind] ?? p.kind}
              </Badge>
            )}
          </span>
          <span className="line-clamp-2 text-sm">{p.rasgos ? `${p.nombre} · ${p.rasgos}` : p.nombre}</span>
        </span>
        {p.cantidad != null && (
          <span className="shrink-0 text-sm font-semibold tabular-nums">×{p.cantidad}</span>
        )}
      </Link>
    </li>
  );
}

export function FichaRecambios({
  recambios,
  proyecciones,
}: {
  recambios: ProductoMini[];
  proyecciones: ProyeccionVista[];
}) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const nCons = recambios.filter((r) => r.kind === "consumable").length;
  const nRep = recambios.filter((r) => r.kind === "spare_part").length;
  const lista = filtro === "todos" ? recambios : recambios.filter((r) => r.kind === filtro);
  const proy = proyecciones.filter((p) => p.url);

  return (
    <div className="space-y-4">
      {proy.length > 0 && (
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {proy.map((p) => (
            <a
              key={p.id}
              href={p.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="w-40 shrink-0 snap-start overflow-hidden rounded-xl border bg-card hover:border-primary/40"
            >
              <span className="flex aspect-square items-center justify-center bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={(p.miniatura ?? p.url) ?? undefined}
                  alt={p.etiqueta ?? "Proyección"}
                  loading="lazy"
                  className="h-full w-full object-contain p-1"
                />
              </span>
              <span className="block truncate px-2 py-1.5 text-xs font-semibold">{p.etiqueta ?? "Proyección"}</span>
            </a>
          ))}
        </div>
      )}

      {recambios.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay consumibles ni repuestos enlazados.</p>
      ) : (
        <>
          {nCons > 0 && nRep > 0 && (
            <div className="grid grid-cols-3 gap-1 rounded-xl border bg-muted p-1" role="group" aria-label="Filtrar recambios">
              {(
                [
                  ["todos", "Todos", recambios.length],
                  ["consumable", "Consumibles", nCons],
                  ["spare_part", "Repuestos", nRep],
                ] as const
              ).map(([v, l, n]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={filtro === v}
                  onClick={() => setFiltro(v)}
                  className={cn(
                    "flex h-11 min-w-0 flex-col items-center justify-center rounded-lg px-1 text-xs leading-tight font-semibold sm:text-sm",
                    filtro === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  <span className="max-w-full truncate">{l}</span>
                  <span className="text-[11px] font-medium tabular-nums opacity-80">{n}</span>
                </button>
              ))}
            </div>
          )}
          <ul className="divide-y">
            {lista.map((p) => (
              <Fila key={p.id} p={p} mostrarTipo />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** En un recambio: equipos en los que se usa. */
export function FichaUsadoEn({ equipos }: { equipos: ProductoMini[] }) {
  if (equipos.length === 0) {
    return <p className="text-sm text-muted-foreground">No está enlazado a ningún equipo.</p>;
  }
  return (
    <ul className="divide-y">
      {equipos.map((p) => (
        <Fila key={p.id} p={p} mostrarTipo={false} />
      ))}
    </ul>
  );
}
