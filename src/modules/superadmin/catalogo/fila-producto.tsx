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

export function Pildora({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function FilaProducto({
  item,
  href,
  recuadro,
  insignias,
  precio,
  neutro = false,
}: {
  item: ItemLista;
  /** Enlace de la fila (por defecto, la ficha del maestro). */
  href?: string;
  /** Recuadro de la izquierda; por defecto, el nº de empresas del maestro. */
  recuadro?: React.ReactNode;
  /** Insignias propias: si se pasan, sustituyen a las del maestro
   *  (descatalogado, sin publicar, incompleto). */
  insignias?: React.ReactNode;
  /** Precio bajo la miniatura (escritorio). */
  precio?: string | null;
  /** Píldora de categoría sin color propio (pantallas de empresa). */
  neutro?: boolean;
}) {
  const recambio = esRecambio(item.kind);
  const estilo = estiloCategoria(item.categoriaKey, item.categoriaRaiz);
  const pildoraCat = neutro ? "bg-muted text-foreground" : estilo.pildora;
  const incompleto = !item.miniatura || item.atributos === 0;
  const nombreCompleto = item.rasgos ? `${item.nombre} · ${item.rasgos}` : item.nombre;

  return (
    <Link
      href={(href ?? `/superadmin/catalogo/productos/${item.id}`) as never}
      className="bg-card hover:border-primary/40 active:bg-muted/40 flex min-h-[76px] items-stretch gap-3 rounded-xl border p-2 transition-colors duration-100"
    >
      {/* Izquierda. TODO stock (fase 6): cuando el maestro tenga stock del
          proveedor, este recuadro enseña las unidades (verde / rojo) con la
          fecha del dato. Mientras tanto: cuántas empresas lo han importado.
          En la empresa, el recuadro es su stock (prop `recuadro`). */}
      {recuadro ?? (
        <span
          className={cn(
            "flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg text-white",
            item.empresas > 0 ? "bg-success" : "bg-muted-foreground/50",
          )}
          title={item.empresas === 1 ? "1 empresa lo tiene" : `${item.empresas} empresas lo tienen`}
        >
          <span className="text-base leading-none font-bold tabular-nums">{item.empresas}</span>
          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">empresas</span>
        </span>
      )}

      {/* Centro */}
      <span className="min-w-0 flex-1 py-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-primary text-lg leading-tight font-bold">{item.ref}</span>
          {item.modelo && (
            <span className="text-muted-foreground max-w-full truncate text-xs font-semibold tracking-wide uppercase">
              {item.modelo}
            </span>
          )}
          {recambio
            ? item.familia && <Pildora className={pildoraCat}>{item.familia}</Pildora>
            : item.categoria && <Pildora className={pildoraCat}>{item.categoria}</Pildora>}
          {item.esVariante ? (
            <Pildora className="bg-muted text-foreground">Variante</Pildora>
          ) : item.variantes > 0 ? (
            <Pildora className="bg-muted text-foreground">{item.variantes} variantes</Pildora>
          ) : null}
          {recambio && (
            <Pildora className="bg-foreground/80 text-background">
              {KIND_ETIQUETA[item.kind]}
            </Pildora>
          )}
          {insignias ?? (
            <>
              {item.descatalogado && (
                <Pildora className="bg-destructive/10 text-destructive">Descatalogado</Pildora>
              )}
              {!item.activo && (
                <Pildora className="bg-muted text-muted-foreground">Inactivo</Pildora>
              )}
              {item.cambiosSinPublicar && (
                <Pildora className="bg-warning/15 text-warning">Sin publicar</Pildora>
              )}
              {incompleto && <Pildora className="bg-amber-100 text-amber-800">Incompleto</Pildora>}
            </>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm">{nombreCompleto}</span>
      </span>

      {/* Derecha */}
      <span className="flex shrink-0 flex-col items-center justify-center gap-1 self-center">
        <span className="bg-muted text-muted-foreground flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg">
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
        {precio && (
          <span className="hidden text-xs font-semibold tabular-nums lg:block">{precio}</span>
        )}
      </span>
    </Link>
  );
}
