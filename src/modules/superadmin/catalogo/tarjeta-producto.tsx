import Link from "next/link";
import { Folder, ImageOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ItemLista } from "./catalogo-lectura";
import { esRecambio } from "./catalogo-etiquetas";

/**
 * Tarjetas de la rejilla (estructura de la tarifa): foto grande
 * `object-contain` sobre fondo claro y el nombre del modelo debajo. Una gama
 * con variantes sale como CARPETA: fondo gris, icono de carpeta, foto de la
 * cabeza, nombre de la gama y «N artículos»; al abrirla salen sus refs.
 */

function Foto({ item, className }: { item: ItemLista; className?: string }) {
  return (
    <span
      className={cn(
        "flex aspect-square w-full items-center justify-center overflow-hidden text-muted-foreground",
        className,
      )}
    >
      {item.miniatura ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.miniatura}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain p-3"
        />
      ) : (
        <ImageOff className="h-8 w-8" aria-label="Sin foto" />
      )}
    </span>
  );
}

/** Producto suelto (o variante dentro de su carpeta). */
export function TarjetaRejilla({
  item,
  nombreCompleto = false,
}: {
  item: ItemLista;
  /** Dentro de una gama: nombre con los rasgos de la variante. */
  nombreCompleto?: boolean;
}) {
  return (
    <Link
      href={`/superadmin/catalogo/productos/${item.id}` as never}
      className="flex w-full flex-col overflow-hidden rounded-xl border bg-card transition-colors duration-100 hover:border-primary active:bg-muted/40"
    >
      <Foto item={item} className="bg-muted/40" />
      <span className="flex flex-1 flex-col gap-0.5 p-3">
        <span className="line-clamp-2 text-sm font-bold uppercase leading-snug text-primary">
          {item.modelo && !esRecambio(item.kind) ? item.modelo : item.nombre}
        </span>
        {nombreCompleto && item.rasgos && (
          <span className="line-clamp-3 text-xs text-foreground/80">{item.rasgos}</span>
        )}
        <span className="text-xs text-muted-foreground">
          <span className="font-mono">{item.ref}</span>
          {item.descatalogado ? " · Descatalogado" : ""}
          {!item.activo ? " · Inactivo" : ""}
        </span>
      </span>
    </Link>
  );
}

/** Gama con variantes, como carpeta. */
export function TarjetaCarpeta({ item, href }: { item: ItemLista; href: string }) {
  return (
    <Link
      href={href as never}
      className="flex w-full flex-col overflow-hidden rounded-xl border bg-muted transition-colors duration-100 hover:border-primary active:bg-muted/70"
    >
      <span className="relative">
        <Foto item={item} />
        <span className="absolute left-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-card text-primary shadow-sm">
          <Folder className="h-4 w-4" aria-hidden="true" />
        </span>
      </span>
      <span className="flex flex-1 flex-col gap-0.5 p-3">
        <span className="line-clamp-2 text-sm font-bold uppercase leading-snug text-primary">
          {item.gamaNombre ?? item.modelo ?? item.nombre}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">{item.variantes} artículos</span>
      </span>
    </Link>
  );
}
