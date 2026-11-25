import {
  Coffee,
  CupSoda,
  Droplet,
  Droplets,
  Filter,
  Flame,
  Package,
  ShieldCheck,
  Snowflake,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Color e icono de cada categoría global del maestro. UN SOLO SITIO: el
 * kiosco de categorías, las píldoras de la fila y las carpetas lo leen de
 * aquí. Las subcategorías heredan el de su categoría raíz; lo que no esté en
 * el mapa sale en neutro.
 *
 * `tarjeta`: fondo pastel + texto del kiosco. `pildora`: píldora de la fila.
 */

export interface EstiloCategoria {
  icono: LucideIcon;
  tarjeta: string;
  icono_cls: string;
  pildora: string;
}

const NEUTRO: EstiloCategoria = {
  icono: Package,
  tarjeta: "bg-muted text-foreground",
  icono_cls: "bg-card text-muted-foreground",
  pildora: "bg-muted text-muted-foreground",
};

const MAPA: Record<string, EstiloCategoria> = {
  dispensers: {
    icono: CupSoda,
    tarjeta: "bg-sky-100 text-sky-950",
    icono_cls: "bg-white/70 text-sky-700",
    pildora: "bg-sky-100 text-sky-800",
  },
  osmosis: {
    icono: Droplet,
    tarjeta: "bg-blue-100 text-blue-950",
    icono_cls: "bg-white/70 text-blue-700",
    pildora: "bg-blue-100 text-blue-800",
  },
  softeners: {
    icono: ShieldCheck,
    tarjeta: "bg-emerald-100 text-emerald-950",
    icono_cls: "bg-white/70 text-emerald-700",
    pildora: "bg-emerald-100 text-emerald-800",
  },
  Grifos: {
    icono: Droplets,
    tarjeta: "bg-cyan-100 text-cyan-950",
    icono_cls: "bg-white/70 text-cyan-700",
    pildora: "bg-cyan-100 text-cyan-800",
  },
  horeca: {
    icono: Coffee,
    tarjeta: "bg-amber-100 text-amber-950",
    icono_cls: "bg-white/70 text-amber-700",
    pildora: "bg-amber-100 text-amber-800",
  },
  ozone: {
    icono: Wind,
    tarjeta: "bg-violet-100 text-violet-950",
    icono_cls: "bg-white/70 text-violet-700",
    pildora: "bg-violet-100 text-violet-800",
  },
  descalers: {
    icono: Zap,
    tarjeta: "bg-lime-100 text-lime-950",
    icono_cls: "bg-white/70 text-lime-700",
    pildora: "bg-lime-100 text-lime-800",
  },
  filters: {
    icono: Filter,
    tarjeta: "bg-teal-100 text-teal-950",
    icono_cls: "bg-white/70 text-teal-700",
    pildora: "bg-teal-100 text-teal-800",
  },
  hydrogen: {
    icono: Droplets,
    tarjeta: "bg-indigo-100 text-indigo-950",
    icono_cls: "bg-white/70 text-indigo-700",
    pildora: "bg-indigo-100 text-indigo-800",
  },
  Gas: {
    icono: Flame,
    tarjeta: "bg-orange-100 text-orange-950",
    icono_cls: "bg-white/70 text-orange-700",
    pildora: "bg-orange-100 text-orange-800",
  },
  Enfriador: {
    icono: Snowflake,
    tarjeta: "bg-slate-100 text-slate-900",
    icono_cls: "bg-white/70 text-slate-600",
    pildora: "bg-slate-100 text-slate-700",
  },
  spare_parts: {
    icono: Wrench,
    tarjeta: "bg-stone-100 text-stone-900",
    icono_cls: "bg-white/70 text-stone-600",
    pildora: "bg-stone-200 text-stone-800",
  },
};

/** Estilo por clave; si no está, el de la raíz; si tampoco, neutro. */
export function estiloCategoria(key: string | null | undefined, raiz?: string | null): EstiloCategoria {
  return (key && MAPA[key]) || (raiz && MAPA[raiz]) || NEUTRO;
}
