import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import type { CategoriaFiltro } from "./catalogo-lectura";
import { estiloCategoria } from "./categorias-estilo";

/**
 * Entrada del catálogo: una tarjeta grande por categoría con productos
 * (icono, nombre y «N artículos») y una aparte para recambios y consumibles.
 * 2 columnas en móvil, 4 en escritorio.
 */

const BASE = "/superadmin/catalogo/productos";

function Tarjeta({
  href,
  clave,
  nombre,
  total,
}: {
  href: string;
  clave: string;
  nombre: string;
  total: number;
}) {
  const e = estiloCategoria(clave);
  const Icono = e.icono;
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
        <span className="block text-sm opacity-75 tabular-nums">
          {total === 1 ? "1 artículo" : `${total.toLocaleString("es-ES")} artículos`}
        </span>
      </span>
    </Link>
  );
}

export function KioscoCategorias({
  categorias,
  totalRecambios,
}: {
  categorias: CategoriaFiltro[];
  totalRecambios: number;
}) {
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
              href={`${BASE}?cat=${encodeURIComponent(c.key)}`}
              clave={c.key}
              nombre={c.nombre}
              total={c.total}
            />
          </li>
        ))}
        {totalRecambios > 0 && (
          <li>
            <Tarjeta
              href={`${BASE}?tipo=recambios`}
              clave="spare_parts"
              nombre="Recambios y consumibles"
              total={totalRecambios}
            />
          </li>
        )}
      </ul>
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
    </div>
  );
}
