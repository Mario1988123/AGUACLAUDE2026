/**
 * Mantenimientos incluidos y aviso «EMPEZAR A PAGAR»
 * (docs/PLAN_MANTENIMIENTOS_INCLUIDOS.md, regla corregida §0.3 del 12-11).
 *
 * Funciones PURAS (sin BD ni red): sirven en servidor y en cliente y llevan
 * tests en logica.test.ts.
 *
 * Regla:
 *  - El dato del equipo es N = nº de mantenimientos ANUALES incluidos (= «N años»).
 *  - La visita anual k-ésima (k = 1 la del mes 12, k = 2 la del 24…) es
 *    GRATIS si k ≤ N y se COBRA si k > N.
 *  - k = round(meses entre la instalación y la visita / 12), en hora de Madrid.
 *    El redondeo tolera visitas adelantadas o retrasadas hasta ±6 meses.
 *  - Renting / financiación de M meses → N = M/12 − 1 (48 → 3).
 *  - Nota «cobrar a partir de AAAA» → N = AAAA − año de instalación − 1.
 *  - Alquiler vivo: incluido mientras el equipo siga de alta, sin N.
 */

export type EstadoMantIncluido =
  | "incluido_alquiler"
  | "sin_dato"
  | "incluido"
  | "ultima_incluida"
  | "a_pagar";

export type Tarifa = "solo_filtros" | "filtros_membrana";
export const TARIFAS: readonly Tarifa[] = ["solo_filtros", "filtros_membrana"] as const;
export const ETIQUETA_TARIFA: Record<Tarifa, string> = {
  solo_filtros: "Solo filtros",
  filtros_membrana: "Filtros + membrana",
};

export type PagoEstado =
  | "incluido"
  | "pendiente"
  | "pagado_oficina"
  | "cobrado_tecnico"
  | "no_cobrado";

export type Modalidad = "cash" | "rental" | "renting" | "installed" | null;

/** Tope de N (igual que el CHECK de la migración). */
export const N_MAXIMO = 30;

/** IVA por defecto si la empresa no tiene otro configurado. */
export const IVA_DEFECTO = 21;

// ---------------------------------------------------------------------------
// Fechas (claves «AAAA-MM-DD» ya en hora de Madrid)
// ---------------------------------------------------------------------------

const RE_CLAVE = /^(\d{4})-(\d{2})-(\d{2})/;

function partes(clave: string): { y: number; m: number; d: number } | null {
  const r = RE_CLAVE.exec(clave);
  if (!r) return null;
  return { y: Number(r[1]), m: Number(r[2]), d: Number(r[3]) };
}

function diasDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Meses (con decimales) entre dos días. Usa la fracción del mes de destino. */
export function mesesEntre(desdeClave: string, hastaClave: string): number | null {
  const a = partes(desdeClave);
  const b = partes(hastaClave);
  if (!a || !b) return null;
  const enteros = (b.y - a.y) * 12 + (b.m - a.m);
  // Día del mes normalizado (el 31 de un mes de 30 días cuenta como fin de mes).
  const da = Math.min(a.d, diasDelMes(b.y, b.m));
  return enteros + (b.d - da) / diasDelMes(b.y, b.m);
}

/** Año de una clave «AAAA-MM-DD». */
export function anioDeClave(clave: string): number | null {
  return partes(clave)?.y ?? null;
}

/**
 * Índice anual de una visita: 1 la del mes 12, 2 la del 24… Mínimo 1 (una
 * visita de mantenimiento antes del primer aniversario cuenta como la 1.ª).
 */
export function indiceVisita(installedAt: string, fechaVisitaClave: string): number | null {
  const meses = mesesEntre(installedAt, fechaVisitaClave);
  if (meses == null) return null;
  // Redondeo «medio hacia arriba» con margen para errores de coma flotante.
  const k = Math.floor(meses / 12 + 0.5 + 1e-9);
  return Math.max(1, k);
}

/**
 * Próximo aniversario de la instalación a partir de hoy (incluido): sirve de
 * «visita teórica» cuando el equipo no tiene ninguna programada.
 */
export function proximoAniversario(installedAt: string, hoyClave: string): string | null {
  const a = partes(installedAt);
  const h = partes(hoyClave);
  if (!a || !h) return null;
  for (let k = 1; k <= 200; k++) {
    const y = a.y + k;
    const d = Math.min(a.d, diasDelMes(y, a.m));
    const clave = `${y}-${String(a.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (clave >= hoyClave) return clave;
  }
  return null;
}

// ---------------------------------------------------------------------------
// N: conversiones
// ---------------------------------------------------------------------------

/** Renting / financiación de M meses → N = M/12 − 1 (nunca negativo). */
export function nDesdeMeses(meses: number): number | null {
  if (!Number.isFinite(meses) || meses <= 0) return null;
  return Math.max(0, Math.floor(meses / 12) - 1);
}

/** «Cobrar a partir de AAAA» → N = AAAA − año de instalación − 1. Null si sale < 0. */
export function nDesdeAnioCobro(anioCobro: number, installedAt: string): number | null {
  const y = anioDeClave(installedAt);
  if (y == null || !Number.isInteger(anioCobro)) return null;
  const n = anioCobro - y - 1;
  return n >= 0 ? n : null;
}

/** ¿Es un N válido para guardar? */
export function nValido(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= N_MAXIMO;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export interface EntradaEstado {
  modalidad: Modalidad;
  /** Equipo de alta (is_active). En alquiler = sigue incluido. */
  activo: boolean;
  n: number | null;
  /** customer_equipment.installed_at («AAAA-MM-DD»). */
  installedAt: string | null;
  /** Día de la visita en Madrid («AAAA-MM-DD»). Si es null se usa el próximo aniversario. */
  fechaVisita: string | null;
  /** Hoy en Madrid («AAAA-MM-DD»). */
  hoy: string;
}

export interface ResultadoEstado {
  estado: EstadoMantIncluido;
  /** Índice anual de la visita considerada (null si no se puede calcular). */
  k: number | null;
  n: number | null;
  /** Año de la última visita incluida (instalación + N). Null si N = 0 o sin dato. */
  anioHasta: number | null;
  /** Año en que empieza a pagar (instalación + N + 1). */
  anioPaga: number | null;
  /** ¿La visita considerada se cobra? */
  seCobra: boolean;
  /** Motivo de «sin dato» para enseñarlo. */
  falta: "n" | "instalacion" | null;
}

export function estadoMantIncluido(e: EntradaEstado): ResultadoEstado {
  const base = { k: null, n: e.n, anioHasta: null, anioPaga: null, seCobra: false, falta: null };
  if (e.modalidad === "rental" && e.activo) {
    return { ...base, estado: "incluido_alquiler" };
  }
  if (e.n == null) return { ...base, estado: "sin_dato", falta: "n" };
  if (!e.installedAt || !partes(e.installedAt)) {
    return { ...base, estado: "sin_dato", falta: "instalacion" };
  }
  const anioInst = anioDeClave(e.installedAt)!;
  const anioHasta = e.n > 0 ? anioInst + e.n : null;
  const anioPaga = anioInst + e.n + 1;
  const fecha = e.fechaVisita ?? proximoAniversario(e.installedAt, e.hoy);
  const k = fecha ? indiceVisita(e.installedAt, fecha) : null;
  if (k == null) {
    return { ...base, estado: "sin_dato", falta: "instalacion", anioHasta, anioPaga };
  }
  const estado: EstadoMantIncluido = k < e.n ? "incluido" : k === e.n ? "ultima_incluida" : "a_pagar";
  return { estado, k, n: e.n, anioHasta, anioPaga, seCobra: k > e.n, falta: null };
}

/** Texto corto del estado para chips y listas. */
export function textoEstado(r: ResultadoEstado, modalidad: Modalidad): string | null {
  switch (r.estado) {
    case "incluido_alquiler":
      return "Mant. incluido (alquiler)";
    case "sin_dato":
      if (r.falta === "instalacion") return "Falta fecha de instalación";
      // Solo en venta se avisa de que falta el dato; en el resto no se pinta nada.
      return modalidad === "cash" ? "Falta nº de mantenimientos incluidos" : null;
    case "incluido":
      return r.anioHasta ? `Mant. incluido hasta la visita de ${r.anioHasta}` : "Mant. incluido";
    case "ultima_incluida":
      return `Última revisión incluida · paga desde ${r.anioPaga}`;
    case "a_pagar":
      return `EMPEZAR A PAGAR · desde ${r.anioPaga}`;
  }
}

// ---------------------------------------------------------------------------
// Precios (céntimos, base SIN IVA)
// ---------------------------------------------------------------------------

export interface PreciosTarifa {
  solo_filtros: number | null;
  filtros_membrana: number | null;
}

export const PRECIOS_VACIOS: PreciosTarifa = { solo_filtros: null, filtros_membrana: null };

export type OrigenPrecio = "equipo" | "cliente" | "modelo" | "empresa" | null;

/** Los cuatro niveles de precio de una visita, del más concreto al más general. */
export interface NivelesPrecio {
  equipo: PreciosTarifa;
  cliente: PreciosTarifa;
  /** Del modelo del equipo (ya resuelta la herencia variante → gama: `preciosDelModelo`). */
  modelo: PreciosTarifa;
  empresa: PreciosTarifa;
}

/** Precio aplicado = equipo > cliente > modelo > empresa (cada tarifa por separado). */
export function precioAplicado(
  tarifa: Tarifa,
  niveles: NivelesPrecio,
): { cents: number | null; origen: OrigenPrecio } {
  const orden = ["equipo", "cliente", "modelo", "empresa"] as const;
  for (const nivel of orden) {
    const v = niveles[nivel][tarifa];
    if (v != null) return { cents: v, origen: nivel };
  }
  return { cents: null, origen: null };
}

/** Lo mínimo de un producto para resolver su precio de mantenimiento. */
export interface ProductoPrecioMant {
  gama_id: string | null;
  precios: PreciosTarifa;
}

/**
 * Precio del MODELO de un equipo, tarifa a tarifa: el del producto; si está
 * vacío y el producto es una variante, el de su gama (un solo nivel).
 */
export function preciosDelModelo(
  productId: string | null,
  productos: ReadonlyMap<string, ProductoPrecioMant>,
): PreciosTarifa {
  if (!productId) return PRECIOS_VACIOS;
  const p = productos.get(productId);
  if (!p) return PRECIOS_VACIOS;
  const g = p.gama_id ? productos.get(p.gama_id) : undefined;
  return {
    solo_filtros: p.precios.solo_filtros ?? g?.precios.solo_filtros ?? null,
    filtros_membrana: p.precios.filtros_membrana ?? g?.precios.filtros_membrana ?? null,
  };
}

/** Total con IVA, redondeado UNA vez al céntimo. */
export function totalConIva(baseCents: number, ivaPct: number): number {
  return Math.round((baseCents * (100 + ivaPct)) / 100);
}

/** «75,00 €» */
export function eur(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** «75,00 € + IVA (90,75 €)» */
export function textoPrecio(baseCents: number | null, ivaPct: number): string {
  if (baseCents == null) return "precio sin definir";
  return `${eur(baseCents)} + IVA (${eur(totalConIva(baseCents, ivaPct))})`;
}

/** Euros escritos por una persona («75», «75,5», «90.75») → céntimos. Null si vacío o inválido. */
export function eurosACentimos(texto: string): number | null {
  const t = texto.trim().replace(/\s|€/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [ent, dec = ""] = t.split(".");
  return Number(ent) * 100 + Number(dec.padEnd(2, "0"));
}

/** Céntimos → texto editable («75,50»). */
export function centimosAEuros(cents: number | null): string {
  if (cents == null) return "";
  const e = Math.floor(cents / 100);
  const c = cents % 100;
  return c === 0 ? String(e) : `${e},${String(c).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Cobro de una visita
// ---------------------------------------------------------------------------

/**
 * Estado de pago EFECTIVO de una visita: lo que haya decidido una persona
 * (pagado en oficina, cobrado o no cobrado) manda; si no, se deriva de k > N.
 * Así las visitas creadas por el cron o antes de la migración también salen
 * bien sin tener que tocar cada sitio que las crea. Las visitas ya cerradas no
 * se reinterpretan: lo cerrado antes de la migración queda como estaba.
 */
export function pagoEfectivo(
  guardado: PagoEstado | null,
  seCobra: boolean,
  /** Visita ya cerrada o cancelada: manda lo guardado (no se cobra hacia atrás). */
  cerrada = false,
): PagoEstado {
  if (guardado && guardado !== "incluido") return guardado;
  if (cerrada) return "incluido";
  return seCobra ? "pendiente" : "incluido";
}

/**
 * Diferencia por membrana: la oficina cobró «solo filtros» y el técnico cambia
 * también la membrana. Devuelve la base SIN IVA que falta (null si no aplica).
 */
export function diferenciaMembrana(
  pagadaTarifa: Tarifa | null,
  hechaTarifa: Tarifa | null,
  precioFiltros: number | null,
  precioMembrana: number | null,
  pagadoBaseCents: number | null,
): number | null {
  if (hechaTarifa !== "filtros_membrana") return null;
  if (pagadaTarifa === "filtros_membrana") return null;
  if (precioMembrana == null) return null;
  const pagado = pagadoBaseCents ?? (pagadaTarifa === "solo_filtros" ? precioFiltros : null);
  if (pagado == null) return null;
  const dif = precioMembrana - pagado;
  return dif > 0 ? dif : null;
}

// ---------------------------------------------------------------------------
// «Pagado en oficina»: marcar y quitar (auditoría 2026-11-13, I2 y M4)
// ---------------------------------------------------------------------------

export interface PagoOficina {
  tarifa: Tarifa | null;
  /** Base SIN IVA pagada en oficina. */
  cents: number | null;
  metodo: string | null;
}

/**
 * Pago en oficina a guardar cuando la visita YA tenía uno anterior (caso
 * diferencia de membrana: la oficina cobró «solo filtros», el técnico hizo
 * filtros + membrana sin cobrar y ahora la oficina cobra la diferencia).
 * La ficha lee `pagado_oficina_cents` como la base TOTAL pagada en oficina,
 * así que:
 *  - importe: se SUMA; si alguna de las dos partes es desconocida, el total
 *    también lo es (null) — las dos partes quedan en el evento;
 *  - tarifa y forma de pago: manda lo nuevo y, si no se indica, lo anterior.
 */
export function combinarPagoOficina(anterior: PagoOficina | null, nuevo: PagoOficina): PagoOficina {
  if (!anterior) return nuevo;
  return {
    tarifa: nuevo.tarifa ?? anterior.tarifa,
    cents: anterior.cents != null && nuevo.cents != null ? anterior.cents + nuevo.cents : null,
    metodo: nuevo.metodo ?? anterior.metodo,
  };
}

/** Lo que había en la visita antes de «Marcar pagado» (va en el evento). */
export interface CobroAntesDePagado {
  is_charged: boolean;
  importe_pendiente_cents: number | null;
}

/**
 * Valores de is_charged / importe_pendiente_cents al QUITAR «pagado en
 * oficina». Si el evento de «marcar» guardó cómo estaba la visita, se
 * restaura eso. Si no (marcas antiguas), se deduce: is_charged = tiene
 * precio (charge_cents) y pendiente = null, que es lo que deja el flujo
 * normal en una visita abierta (el pendiente solo se escribe al cerrar).
 */
export function cobroTrasQuitarPagado(
  anterior: unknown,
  chargeCents: number | null,
): CobroAntesDePagado {
  if (anterior && typeof anterior === "object") {
    const a = anterior as Record<string, unknown>;
    const pend = a.importe_pendiente_cents;
    if (
      typeof a.is_charged === "boolean" &&
      (pend === null || (typeof pend === "number" && Number.isInteger(pend) && pend >= 0))
    ) {
      return { is_charged: a.is_charged, importe_pendiente_cents: pend as number | null };
    }
  }
  return { is_charged: chargeCents != null, importe_pendiente_cents: null };
}
