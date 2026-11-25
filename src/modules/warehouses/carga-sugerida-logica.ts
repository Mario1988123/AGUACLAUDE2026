/**
 * Carga sugerida de la furgoneta: lógica pura, sin base de datos (con tests).
 *
 * Mario 2026-11-25: la sugerencia es lo que el técnico necesita para los
 * trabajos del día de carga MÁS reponer la reserva fija, MENOS lo que ya
 * lleva en la furgoneta. Plan modelo de equipo, sección 6, punto 4:
 *   necesita_total = necesidad_dia + reserva
 *   a_cargar       = max(0, necesita_total − lleva)
 *   sobra          = max(0, lleva − necesita_total)
 *
 * Un artículo es un producto (`products`) o un filtro (`product_filters`):
 * viven en tablas y stocks distintos, así que la clave lleva el tipo.
 */

export type TipoArticulo = "producto" | "filtro";

export interface CantidadArticulo {
  tipo: TipoArticulo;
  id: string;
  cantidad: number;
}

export type MomentoCarga = "tarde" | "manana";

export const MOMENTO_LABEL: Record<MomentoCarga, string> = {
  tarde: "Por la tarde, al acabar (cargo para mañana)",
  manana: "Por la mañana, antes de salir (cargo para hoy)",
};

export function esMomentoCarga(v: unknown): v is MomentoCarga {
  return v === "tarde" || v === "manana";
}

export function claveArticulo(a: { tipo: TipoArticulo; id: string }): string {
  return `${a.tipo === "producto" ? "p" : "f"}:${a.id}`;
}

/** Cantidad entera y no negativa; lo que no sea número cuenta 0. */
function entero(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  return v > 0 ? v : 0;
}

/** Suma por artículo (líneas repetidas del mismo artículo se juntan). */
export function sumarPorArticulo(lineas: CantidadArticulo[]): Map<string, CantidadArticulo> {
  const m = new Map<string, CantidadArticulo>();
  for (const l of lineas) {
    const c = entero(l.cantidad);
    const k = claveArticulo(l);
    const prev = m.get(k);
    if (prev) prev.cantidad += c;
    else m.set(k, { tipo: l.tipo, id: l.id, cantidad: c });
  }
  return m;
}

/**
 * Reserva efectiva de una furgoneta (Mario 2026-11-25: la reserva LA ELIGE EL
 * TÉCNICO). Si la furgoneta tiene reserva propia, vale SOLO esa; si no tiene
 * ninguna fila, se usa la de la empresa como plantilla. [decide] No se mezclan:
 * lo que el técnico quita de su reserva no vuelve por la de la empresa.
 * Las cantidades 0 no cuentan. Si hay filas repetidas, manda la última.
 */
export function resolverReserva(
  empresa: CantidadArticulo[],
  furgoneta: CantidadArticulo[],
): Map<string, CantidadArticulo> {
  const base = furgoneta.length > 0 ? furgoneta : empresa;
  const m = new Map<string, CantidadArticulo>();
  for (const r of base) m.set(claveArticulo(r), { tipo: r.tipo, id: r.id, cantidad: entero(r.cantidad) });
  for (const [k, v] of m) if (v.cantidad === 0) m.delete(k);
  return m;
}

export interface LineaSugerida {
  tipo: TipoArticulo;
  id: string;
  /** Lo que piden los trabajos del día. */
  necesidad: number;
  /** Reserva fija de la furgoneta para este artículo. */
  reserva: number;
  /** Lo que ya lleva la furgoneta (estado nuevo). */
  lleva: number;
  /** Total a cargar = paraTrabajos + paraReserva. */
  aCargar: number;
  /** Parte de la carga que piden los trabajos (lo que lleva cubre primero los trabajos). */
  paraTrabajos: number;
  /** Parte de la carga que repone la reserva. */
  paraReserva: number;
  /** Lo que lleva de más sobre trabajos + reserva. */
  sobra: number;
}

export interface CargaSugerida {
  /** Solo las líneas con algo que cargar, ordenadas: primero trabajos. */
  aCargar: LineaSugerida[];
  /** Lo que lleva de más (solo tiene sentido si hay reserva definida). */
  sobrantes: LineaSugerida[];
  /** Cubiertas: hacen falta y ya las lleva. */
  cubiertas: LineaSugerida[];
  totalUnidades: number;
}

export function calcularCargaSugerida(entrada: {
  necesidad: CantidadArticulo[];
  reserva: Map<string, CantidadArticulo> | CantidadArticulo[];
  lleva: CantidadArticulo[];
}): CargaSugerida {
  const nec = sumarPorArticulo(entrada.necesidad);
  const res = Array.isArray(entrada.reserva) ? sumarPorArticulo(entrada.reserva) : entrada.reserva;
  const lle = sumarPorArticulo(entrada.lleva);

  const claves = new Set<string>([...nec.keys(), ...res.keys(), ...lle.keys()]);
  const aCargar: LineaSugerida[] = [];
  const sobrantes: LineaSugerida[] = [];
  const cubiertas: LineaSugerida[] = [];

  for (const k of claves) {
    const base = nec.get(k) ?? res.get(k) ?? lle.get(k)!;
    const necesidad = nec.get(k)?.cantidad ?? 0;
    const reserva = res.get(k)?.cantidad ?? 0;
    const lleva = lle.get(k)?.cantidad ?? 0;
    const total = necesidad + reserva;
    const carga = Math.max(0, total - lleva);
    const paraTrabajos = Math.max(0, necesidad - lleva);
    const linea: LineaSugerida = {
      tipo: base.tipo,
      id: base.id,
      necesidad,
      reserva,
      lleva,
      aCargar: carga,
      paraTrabajos,
      paraReserva: carga - paraTrabajos,
      sobra: Math.max(0, lleva - total),
    };
    if (linea.aCargar > 0) aCargar.push(linea);
    else if (total > 0) cubiertas.push(linea);
    if (linea.sobra > 0) sobrantes.push(linea);
  }

  aCargar.sort((a, b) => b.paraTrabajos - a.paraTrabajos || b.aCargar - a.aCargar);
  return {
    aCargar,
    sobrantes,
    cubiertas,
    totalUnidades: aCargar.reduce((s, l) => s + l.aCargar, 0),
  };
}

export interface AsignacionFiltro {
  product_id: string;
  filter_id: string;
  quantity_per_change: number | null;
  is_required: boolean | null;
}

/**
 * Filtros que pide UN mantenimiento de un equipo. Reglas del plan (decisiones
 * 16 y 17):
 *  - equipo sin modelo (sin producto) → nada: lo cubre la reserva;
 *  - las membranas NO entran (se sabe si hacen falta al medir): reserva;
 *  - solo filtros obligatorios; `quantity_per_change` (por defecto 1).
 * `productoFiltros` es el producto del que se leen los filtros (variante con
 * filtros propios o, si no, su gama: `productoDeFiltros`).
 */
export function filtrosDeMantenimiento(
  productoFiltros: string | null,
  asignaciones: AsignacionFiltro[],
  esMembrana: (filterId: string) => boolean,
): CantidadArticulo[] {
  if (!productoFiltros) return [];
  return asignaciones
    .filter((a) => a.product_id === productoFiltros && a.is_required !== false && !esMembrana(a.filter_id))
    .map((a) => ({ tipo: "filtro" as const, id: a.filter_id, cantidad: entero(a.quantity_per_change ?? 1) || 1 }));
}

/**
 * Día que cubre la carga, como clave YYYY-MM-DD de Madrid: quien carga por
 * la tarde carga para mañana; quien carga por la mañana, para hoy.
 */
export function diaDeCarga(momento: MomentoCarga, hoyClave: string, sumarDias: (c: string, n: number) => string): string {
  return momento === "tarde" ? sumarDias(hoyClave, 1) : hoyClave;
}

/**
 * Ajuste a mano del técnico sobre la sugerencia: se queda con las líneas con
 * cantidad > 0, enteras y con tope (500, el mismo que la carga manual).
 */
export function lineasConfirmadas(lineas: CantidadArticulo[]): CantidadArticulo[] {
  return Array.from(sumarPorArticulo(lineas).values())
    .map((l) => ({ ...l, cantidad: Math.min(500, l.cantidad) }))
    .filter((l) => l.cantidad > 0);
}
