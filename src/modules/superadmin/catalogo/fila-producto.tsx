import Link from "next/link";
import { Building2, ImageOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ItemLista } from "./catalogo-lectura";
import { KIND_ETIQUETA, esRecambio } from "./catalogo-etiquetas";
import { estiloCategoria } from "./categorias-estilo";

/**
 * UNA fila de la lista del maestro, con la estructura de la tarifa de
 * Osmofilter: recuadro de color a la izquierda, referencia grande, modelo y
 * píldoras en la primera línea, nombre completo en la segunda y miniatura a la
 * derecha. Toda la tarjeta es un enlace a la ficha.
 *
 * Es el único sitio que decide cómo se ve una fila: para cambiar el formato se
 * toca solo este fichero.
 */

function Pildora({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-[11px] font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function FilaProducto({ item }: { item: ItemLista }) {
  const recambio = esRecambio(item.kind);
  const estilo = estiloCategoria(item.categoriaKey, item.categoriaRaiz);
  const incompleto = !item.miniatura || item.atributos === 0;
  const nombreCompleto = item.rasgos ? `${item.nombre} · ${item.rasgos}` : item.nombre;

  return (
    <Link
      href={`/superadmin/catalogo/productos/${item.id}` as never}
      className="flex min-h-[76px] items-stretch gap-3 rounded-xl border bg-card p-2 transition-colors duration-100 hover:border-primary/40 active:bg-muted/40"
    >
      {/* Izquierda. TODO stock (fase 6): cuando el maestro tenga stock del
          proveedor, este recuadro enseña las unidades (verde / rojo) con la
          fecha del dato. Mientras tanto: cuántas empresas lo han importado. */}
      <span
        className={cn(
          "flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg text-white",
          item.empresas > 0 ? "bg-success" : "bg-muted-foreground/50",
        )}
        title={item.empresas === 1 ? "1 empresa lo tiene" : `${item.empresas} empresas lo tienen`}
      >
        <span className="text-base font-bold leading-none tabular-nums">{item.empresas}</span>
        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">empresas</span>
      </span>

      {/* Centro */}
      <span className="min-w-0 flex-1 py-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-lg font-bold leading-tight text-primary">{item.ref}</span>
          {item.modelo && (
            <span className="max-w-full truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {item.modelo}
            </span>
          )}
          {recambio ? (
            item.familia && <Pildora className={estilo.pildora}>{item.familia}</Pildora>
          ) : (
            item.categoria && <Pildora className={estilo.pildora}>{item.categoria}</Pildora>
          )}
          {item.esVariante ? (
            <Pildora className="bg-muted text-foreground">Variante</Pildora>
          ) : item.variantes > 0 ? (
            <Pildora className="bg-muted text-foreground">{item.variantes} variantes</Pildora>
          ) : null}
          {recambio && (
            <Pildora className="bg-foreground/80 text-background">{KIND_ETIQUETA[item.kind]}</Pildora>
          )}
          {item.descatalogado && <Pildora className="bg-destructive/10 text-destructive">Descatalogado</Pildora>}
          {!item.activo && <Pildora className="bg-muted text-muted-foreground">Inactivo</Pildora>}
          {item.cambiosSinPublicar && <Pildora className="bg-warning/15 text-warning">Sin publicar</Pildora>}
          {incompleto && <Pildora className="bg-amber-100 text-amber-800">Incompleto</Pildora>}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm">{nombreCompleto}</span>
      </span>

      {/* Derecha */}
      <span className="flex h-14 w-14 shrink-0 items-center justify-center self-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        {item.miniatura ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.miniatura}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-0.5"
          />
        ) : (
          <ImageOff className="h-5 w-5" aria-label="Sin foto" />
        )}
      </span>
    </Link>
  );
}
