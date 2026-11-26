import Link from "next/link";
import { ImageOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ProductoMini } from "./catalogo-lectura";

/**
 * Variantes de la gama: TODAS, cabeza incluida, con la actual marcada. El
 * usuario no tiene por qué saber cuál es la cabeza.
 */
export function FichaVariantes({
  variantes,
  actualId,
  hrefDe = (id) => `/superadmin/catalogo/productos/${id}`,
}: {
  variantes: ProductoMini[];
  actualId: string;
  /** Enlace de cada variante (superadmin por defecto; la empresa pasa el suyo). */
  hrefDe?: (id: string) => string;
}) {
  if (variantes.length === 0) return null;
  return (
    <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 xl:grid-cols-4">
      {variantes.map((v) => {
        const actual = v.id === actualId;
        return (
          <li key={v.id} className="w-36 shrink-0 snap-start lg:w-auto">
            <Link
              href={hrefDe(v.id) as never}
              aria-current={actual ? "page" : undefined}
              className={cn(
                "flex h-full flex-col overflow-hidden rounded-xl border-2 bg-card transition-colors duration-100",
                actual ? "border-primary" : "border-border hover:border-primary/40",
              )}
            >
              <div className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground">
                {v.miniatura ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.miniatura} alt={v.nombre} loading="lazy" className="h-full w-full object-contain p-1" />
                ) : (
                  <ImageOff className="h-5 w-5" aria-label="Sin foto" />
                )}
              </div>
              <div className="space-y-0.5 p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-mono text-xs font-semibold">{v.ref}</span>
                  {actual && <span className="shrink-0 text-[11px] font-bold text-primary">Esta</span>}
                </div>
                <div className="line-clamp-3 text-xs text-muted-foreground">{v.rasgos ?? v.nombre}</div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
