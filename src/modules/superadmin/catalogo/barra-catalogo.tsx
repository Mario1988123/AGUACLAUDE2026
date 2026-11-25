"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/shared/lib/utils";

/**
 * Barra de secciones del catálogo maestro, común a todas sus pantallas.
 * Pestañas como enlaces de 44 px; si no caben (390 px) la barra tiene su
 * propio scroll horizontal y la página no se desborda.
 */

const BASE = "/superadmin/catalogo";

type Seccion = "productos" | "recambios" | "categorias" | "atributos" | "fabricantes" | "modelos";

const SECCIONES: Array<{ id: Seccion; label: string; href: string }> = [
  { id: "productos", label: "Productos", href: `${BASE}/productos` },
  { id: "recambios", label: "Recambios", href: `${BASE}/productos?tipo=recambios` },
  { id: "categorias", label: "Categorías", href: `${BASE}/categorias` },
  { id: "atributos", label: "Atributos", href: `${BASE}/atributos` },
  { id: "fabricantes", label: "Fabricantes", href: `${BASE}/fabricantes` },
  { id: "modelos", label: "Modelos externos", href: `${BASE}/modelos-externos` },
];

function seccionActiva(pathname: string, tipo: string | null): Seccion | null {
  if (pathname.startsWith(`${BASE}/productos`)) {
    return pathname === `${BASE}/productos` && tipo === "recambios" ? "recambios" : "productos";
  }
  if (pathname.startsWith(`${BASE}/categorias`)) return "categorias";
  if (pathname.startsWith(`${BASE}/atributos`)) return "atributos";
  if (pathname.startsWith(`${BASE}/fabricantes`)) return "fabricantes";
  if (pathname.startsWith(`${BASE}/modelos-externos`)) return "modelos";
  return null;
}

export function BarraCatalogo() {
  const pathname = usePathname();
  const tipo = useSearchParams().get("tipo");
  const activa = seccionActiva(pathname, tipo);
  const lista = useRef<HTMLUListElement>(null);

  // En móvil no caben todas: la pestaña activa se desplaza a la vista.
  useEffect(() => {
    const ul = lista.current;
    const a = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ul || !a) return;
    const izq = a.offsetLeft - ul.offsetLeft;
    if (izq < ul.scrollLeft || izq + a.offsetWidth > ul.scrollLeft + ul.clientWidth) {
      ul.scrollTo({ left: Math.max(0, izq - 16) });
    }
  }, [activa]);

  return (
    <nav aria-label="Secciones del catálogo maestro" className="-mx-1 min-w-0">
      <ul
        ref={lista}
        className="flex gap-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SECCIONES.map((s) => {
          const on = s.id === activa;
          return (
            <li key={s.id} className="shrink-0">
              <Link
                href={s.href as never}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-colors",
                  on
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mientras se resuelven los parámetros de la URL: la misma barra sin activa. */
export function BarraCatalogoEsqueleto() {
  return (
    <nav aria-label="Secciones del catálogo maestro" className="-mx-1 min-w-0">
      <ul className="flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECCIONES.map((s) => (
          <li key={s.id} className="shrink-0">
            <Link
              href={s.href as never}
              className="text-muted-foreground inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold whitespace-nowrap"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
