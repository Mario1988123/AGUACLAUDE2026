import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import type { CategoriaFiltro } from "./catalogo-lectura";
import { estiloCategoria } from "./categorias-estilo";

/**
 * Entrada del catálogo: una tarjeta grande por categoría con productos
 * (icono, nombre y «N artículos») y una aparte para recambios y consumibles.
 * 2 columnas en móvil, 4 en escritorio.
 */

const BASE_MAESTRO = "/superadmin/catalogo/productos";

/** Categoría del kiosco; `miniatura` e `iconoClave` solo los usa el modo neutro. */
export type CategoriaKiosco = CategoriaFiltro & {
  miniatura?: string | null;
  /** Clave global para elegir el icono cuando no hay foto. */
  iconoClave?: string | null;
  /** Enlace propio (si no, `${base}?cat=key`). */
  href?: string;
};

function Tarjeta({
  href,
  clave,
  nombre,
  total,
  neutro,
  miniatura,
  unidad,
}: {
  href: string;
  clave: string;
  nombre: string;
  total: number;
  neutro?: boolean;
  miniatura?: string | null;
  unidad: [string, string];
}) {
  const e = estiloCategoria(clave);
  const Icono = e.icono;
  const recuento =
    total === 1 ? `1 ${unidad[0]}` : `${total.toLocaleString("es-ES")} ${unidad[1]}`;
  if (neutro) {
    // Empresa: todas iguales (bg-card con borde); lo que distingue es la foto.
    return (
      <Link
        href={href as never}
        className="flex h-[148px] flex-col overflow-hidden rounded-2xl border bg-card transition-[border-color,transform] duration-100 hover:border-primary/40 active:scale-[0.97] lg:h-44"
      >
        <span className="flex min-h-0 flex-1 items-center justify-center bg-muted text-muted-foreground">
          {miniatura ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={miniatura} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain p-2" />
          ) : (
            <Icono className="h-7 w-7" aria-hidden="true" />
          )}
        </span>
        <span className="px-3 py-2">
          <span className="block truncate text-sm font-bold leading-tight">{nombre}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">{recuento}</span>
        </span>
      </Link>
    );
  }
  return (
    <Link
      href={href as never}
      className={cn(
        "flex min-h-32 flex-col justify-between gap-3 rounded-2xl p-4 transition-[filter,transform] duration-100 hover:brightness-95 active:scale-[0.98]",
        e.tarjeta,
      )}
    >
      <span className={cn("inline-flex h-11 w-11 items-center justify-center rounded-xl", e.icono_cls)}>
        <Icono className="h-6 w-6" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-base font-bold leading-tight">{nombre}</span>
        <span className="block text-sm opacity-75 tabular-nums">{recuento}</span>
      </span>
    </Link>
  );
}

export function KioscoCategorias({
  categorias,
  totalRecambios,
  base = BASE_MAESTRO,
  neutro = false,
  unidad = ["artículo", "artículos"],
  recambios,
  pie,
}: {
  categorias: CategoriaKiosco[];
  totalRecambios: number;
  /** Ruta de la lista (superadmin por defecto). */
  base?: string;
  /** Tarjetas sin color propio, con foto (pantallas de empresa). */
  neutro?: boolean;
  unidad?: [string, string];
  /** Tarjeta de recambios propia (si no, la del maestro). */
  recambios?: { href: string; nombre: string; total: number } | null;
  /** Enlaces bajo la rejilla; por defecto, los del maestro. */
  pie?: React.ReactNode;
}) {
  const BASE = base;
  const tarjetaRecambios =
    recambios === undefined
      ? totalRecambios > 0
        ? { href: `${BASE}?tipo=recambios`, nombre: "Recambios y consumibles", total: totalRecambios }
        : null
      : recambios;
  const raices = categorias
    .filter((c) => !c.padre && c.total > 0)
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
  const totalEquipos = raices.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {raices.map((c) => (
          <li key={c.key}>
            <Tarjeta
              href={c.href ?? `${BASE}?cat=${encodeURIComponent(c.key)}`}
              clave={c.iconoClave ?? c.key}
              nombre={c.nombre}
              total={c.total}
              neutro={neutro}
              miniatura={c.miniatura}
              unidad={unidad}
            />
          </li>
        ))}
        {tarjetaRecambios && (
          <li>
            <Tarjeta
              href={tarjetaRecambios.href}
              clave="spare_parts"
              nombre={tarjetaRecambios.nombre}
              total={tarjetaRecambios.total}
              neutro={neutro}
              unidad={unidad}
            />
          </li>
        )}
      </ul>
      {pie !== undefined ? pie : (
      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href={`${BASE}?vista=lista` as never}
          className="inline-flex h-11 items-center rounded-xl border bg-card px-4 font-semibold hover:bg-muted"
        >
          Ver los {totalEquipos.toLocaleString("es-ES")} equipos en lista
        </Link>
        <Link
          href={`${BASE}?estado=incompletos&vista=lista` as never}
          className="inline-flex h-11 items-center rounded-xl border bg-card px-4 font-semibold hover:bg-muted"
        >
          Incompletos
        </Link>
      </div>
      )}
    </div>
  );
}
