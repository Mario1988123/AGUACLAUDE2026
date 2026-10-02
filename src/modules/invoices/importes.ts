/**
 * IMPORTES DE FACTURACIÓN — LÓGICA PURA (sin BD, sin "server-only")
 *
 * Todo en céntimos ENTEROS. Reglas:
 *  · El IVA se calcula POR LÍNEA (igual que ha hecho siempre el módulo) y la
 *    cabecera suma las líneas, así que base + IVA = total es exacto por
 *    construcción en cada línea y en la factura.
 *  · El redondeo es "mitad lejos del cero" sobre la MAGNITUD, de modo que una
 *    línea negativa (rectificativa) es exactamente la opuesta de la positiva:
 *    Math.round(-262.5) daría -262 y la rectificativa no anularía 263.
 *  · Nada de coma flotante en los redondeos: cantidades con 3 decimales y
 *    porcentajes con 2 se pasan a enteros (milésimas / centésimas) y se divide
 *    con aritmética entera.
 *  · Precio con IVA incluido (particulares): el total de la línea es el que
 *    manda; base = total / (1 + tipo) redondeada, e IVA = total − base. Antes
 *    se buscaba una base b con b + round(b·21 %) = total, que no existe para
 *    todos los importes (100,00 € salía 100,01 €).
 *
 * Lo importan create-core.ts (servidor) y el formulario de factura (cliente).
 */

export type TipoFactura = "invoice" | "credit_note" | "proforma" | "delivery_note";

/** Línea tal como la recibe la creación de facturas. */
export interface LineaImporte {
  description: string;
  quantity: number;
  unit_price_cents: number;
  discount_percent: number;
  tax_rate_percent: number;
  /**
   * El precio unitario lleva el IVA dentro (cuota o precio de particular).
   * El total de la línea se respeta al céntimo y se desglosa hacia atrás.
   */
  iva_incluido?: boolean;
  /**
   * Importes ya calculados que hay que respetar tal cual (copia exacta de una
   * línea emitida, p. ej. al rectificar). Si vienen, no se recalcula nada.
   */
  importes_fijos?: { subtotal_cents: number; tax_cents: number } | null;
}

export interface TotalesLinea {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
}

/** Mayor entero que no pierde precisión en un double. */
const MAX_SEGURO = Number.MAX_SAFE_INTEGER;

/**
 * División entera con redondeo "mitad lejos del cero". `numerador` y
 * `divisor` deben ser enteros y el divisor positivo.
 */
export function dividirRedondeando(numerador: number, divisor: number): number {
  if (!Number.isInteger(numerador) || !Number.isInteger(divisor) || divisor <= 0) {
    throw new Error("Importe fuera de rango para redondear");
  }
  if (Math.abs(numerador) > MAX_SEGURO / 2) {
    throw new Error("Importe demasiado grande");
  }
  const signo = numerador < 0 ? -1 : 1;
  const abs = Math.abs(numerador);
  const cociente = Math.floor(abs / divisor);
  const resto = abs - cociente * divisor;
  const redondeado = resto * 2 >= divisor ? cociente + 1 : cociente;
  // Evita el -0
  return redondeado === 0 ? 0 : signo * redondeado;
}

/** Convierte un decimal con como mucho `decimales` cifras a entero escalado. */
function aEntero(valor: number, decimales: number, nombre: string): number {
  const factor = 10 ** decimales;
  const escalado = Math.round(valor * factor);
  if (!Number.isFinite(valor) || Math.abs(escalado - valor * factor) > 1e-6 * Math.max(1, Math.abs(valor * factor))) {
    throw new Error(`${nombre} admite como mucho ${decimales} decimales`);
  }
  return escalado;
}

/** Cantidad → milésimas enteras (la columna es numeric con 3 decimales). */
export function cantidadEnMilesimas(cantidad: number): number {
  return aEntero(cantidad, 3, "La cantidad");
}

/** Porcentaje → centésimas enteras (21 % → 2100). */
export function porcentajeEnCentesimas(pct: number): number {
  return aEntero(pct, 2, "El porcentaje");
}

/**
 * Desglosa un total con IVA incluido: base redondeada e IVA = total − base.
 * base + IVA == total siempre, y el IVA difiere como mucho 1 céntimo de
 * round(base · tipo), que es la tolerancia habitual.
 */
export function desglosarIvaIncluido(
  totalCents: number,
  ivaPercent: number,
): { base_cents: number; tax_cents: number; total_cents: number } {
  if (!Number.isInteger(totalCents)) throw new Error("El total debe ir en céntimos enteros");
  const tipo = porcentajeEnCentesimas(ivaPercent);
  const base = dividirRedondeando(totalCents * 10000, 10000 + tipo);
  return { base_cents: base, tax_cents: totalCents - base, total_cents: totalCents };
}

/** IVA de una base (redondeo por magnitud). */
export function ivaDeBase(baseCents: number, ivaPercent: number): number {
  return dividirRedondeando(baseCents * porcentajeEnCentesimas(ivaPercent), 10000);
}

/** Totales de una línea. Es la ÚNICA fórmula: servidor, formulario y tests. */
export function calcularLinea(linea: LineaImporte): TotalesLinea {
  if (linea.importes_fijos) {
    const { subtotal_cents, tax_cents } = linea.importes_fijos;
    if (!Number.isInteger(subtotal_cents) || !Number.isInteger(tax_cents)) {
      throw new Error("Importes de línea no enteros");
    }
    return { subtotal_cents, tax_cents, total_cents: subtotal_cents + tax_cents };
  }
  if (!Number.isInteger(linea.unit_price_cents)) {
    throw new Error("El precio debe ir en céntimos enteros");
  }
  const q = cantidadEnMilesimas(linea.quantity);
  const bruto = dividirRedondeando(linea.unit_price_cents * q, 1000);
  const descuento = dividirRedondeando(
    bruto * porcentajeEnCentesimas(linea.discount_percent || 0),
    10000,
  );
  const neto = bruto - descuento;
  if (linea.iva_incluido) {
    const d = desglosarIvaIncluido(neto, linea.tax_rate_percent);
    return { subtotal_cents: d.base_cents, tax_cents: d.tax_cents, total_cents: d.total_cents };
  }
  const iva = ivaDeBase(neto, linea.tax_rate_percent);
  return { subtotal_cents: neto, tax_cents: iva, total_cents: neto + iva };
}

/**
 * Precio unitario que se GUARDA en invoice_lines.unit_price_cents. En una
 * línea normal es el que llega. En una con IVA incluido se guarda la base
 * unitaria, para que la factura muestre base, IVA y total coherentes (con
 * cantidad 1 es exacta; con más unidades puede diferir un céntimo de
 * subtotal/cantidad, por eso el PDF muestra el subtotal guardado).
 */
export function precioUnitarioAGuardar(linea: LineaImporte, totales: TotalesLinea): number {
  if (linea.importes_fijos || !linea.iva_incluido) return linea.unit_price_cents;
  const q = cantidadEnMilesimas(linea.quantity);
  return dividirRedondeando(Math.abs(totales.subtotal_cents) * 1000, Math.abs(q));
}

/** Suma de cabecera. */
export function totalesFactura(lineas: LineaImporte[]): TotalesLinea {
  let subtotal = 0;
  let iva = 0;
  for (const l of lineas) {
    const t = calcularLinea(l);
    subtotal += t.subtotal_cents;
    iva += t.tax_cents;
  }
  return { subtotal_cents: subtotal, tax_cents: iva, total_cents: subtotal + iva };
}

/**
 * Valida las líneas ANTES de numerar: cualquier error aquí no quema número
 * de serie. Devuelve el primer error legible o null.
 *
 *  · factura/proforma/albarán: cantidades > 0.
 *  · rectificativa (por diferencias): cantidades < 0.
 *  · precio entero ≥ 0, descuento 0..100, IVA 0..100.
 */
export function validarLineasFactura(lineas: LineaImporte[], tipo: TipoFactura): string | null {
  if (!Array.isArray(lineas) || lineas.length === 0) return "Añade al menos una línea";
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!;
    const n = `Línea ${i + 1}`;
    if (!l.description || !String(l.description).trim()) return `${n}: falta la descripción`;
    const cantidad = Number(l.quantity);
    if (!Number.isFinite(cantidad) || cantidad === 0) return `${n}: la cantidad no puede estar vacía ni ser 0`;
    try {
      cantidadEnMilesimas(cantidad);
    } catch {
      return `${n}: la cantidad admite como mucho 3 decimales`;
    }
    if (tipo === "credit_note" && cantidad > 0) return `${n}: en una rectificativa la cantidad va en negativo`;
    if (tipo !== "credit_note" && cantidad < 0) return `${n}: la cantidad debe ser mayor que 0`;
    if (!Number.isInteger(l.unit_price_cents) || l.unit_price_cents < 0) {
      return `${n}: el precio debe ser un importe válido (0 o más)`;
    }
    const dto = Number(l.discount_percent ?? 0);
    if (!Number.isFinite(dto) || dto < 0 || dto > 100) return `${n}: el descuento debe estar entre 0 y 100 %`;
    const iva = Number(l.tax_rate_percent);
    if (!Number.isFinite(iva) || iva < 0 || iva > 100) return `${n}: el IVA debe estar entre 0 y 100 %`;
    try {
      porcentajeEnCentesimas(dto);
      porcentajeEnCentesimas(iva);
    } catch {
      return `${n}: los porcentajes admiten como mucho 2 decimales`;
    }
    if (l.iva_incluido && dto !== 0) return `${n}: una línea con IVA incluido no admite descuento`;
    if (l.importes_fijos) {
      const { subtotal_cents: s, tax_cents: t } = l.importes_fijos;
      if (!Number.isInteger(s) || !Number.isInteger(t)) return `${n}: importes no válidos`;
      const signo = tipo === "credit_note" ? -1 : 1;
      if (s * signo < 0 || t * signo < 0) return `${n}: el signo de los importes no cuadra con el tipo de factura`;
    }
    try {
      calcularLinea(l);
    } catch (e) {
      return `${n}: ${e instanceof Error ? e.message : "importe no válido"}`;
    }
  }
  return null;
}

/**
 * Reparto base/IVA de una cuota mensual según el destinatario:
 *   · particular         → la cuota lleva el IVA dentro → se desglosa
 *   · empresa/autónomo   → la cuota es BASE → se suma el IVA
 */
export function esEmpresaOAutonomo(
  destinatario: { party_kind?: string | null; is_autonomo?: boolean | null } | null | undefined,
): boolean {
  if (!destinatario) return false;
  return destinatario.party_kind === "company" || destinatario.is_autonomo === true;
}

export function splitMonthlyFee(
  monthlyCents: number,
  ivaPercent: number,
  recipient: { party_kind?: string | null; is_autonomo?: boolean | null } | null,
): { base_cents: number; tax_cents: number; total_cents: number } {
  if (esEmpresaOAutonomo(recipient)) {
    const tax = ivaDeBase(monthlyCents, ivaPercent);
    return { base_cents: monthlyCents, tax_cents: tax, total_cents: monthlyCents + tax };
  }
  return desglosarIvaIncluido(monthlyCents, ivaPercent);
}

// ---------------------------------------------------------------------------
// Cobros de facturas
// ---------------------------------------------------------------------------

/** Pendiente de una factura. Rectificativas y facturas cerradas: 0. */
export function pendienteFactura(f: {
  kind: string;
  status: string;
  total_cents: number;
  pagado_cents: number;
}): number {
  if (f.kind === "credit_note" || f.kind === "proforma" || f.kind === "delivery_note") return 0;
  if (f.status === "paid" || f.status === "cancelled" || f.status === "void") return 0;
  return Math.max(0, f.total_cents - f.pagado_cents);
}

/**
 * ¿Se puede registrar este cobro? Devuelve el error o null. Es la misma
 * regla que aplica la RPC `registrar_cobro_factura` con la fila bloqueada.
 */
export function validarCobroFactura(args: {
  kind: string;
  status: string;
  total_cents: number;
  pagado_cents: number;
  importe_cents: number;
  permitir_borrador: boolean;
}): string | null {
  if (args.kind !== "invoice") return "Solo se cobran facturas ordinarias";
  const estadosValidos = args.permitir_borrador
    ? ["draft", "issued", "overdue"]
    : ["issued", "overdue"];
  if (!estadosValidos.includes(args.status)) {
    if (args.status === "draft") return "Emite la factura antes de registrar el cobro";
    if (args.status === "paid") return "La factura ya está totalmente cobrada";
    return `No se puede cobrar una factura en estado ${args.status}`;
  }
  if (!Number.isInteger(args.importe_cents) || args.importe_cents <= 0) {
    return "El importe del cobro debe ser mayor que 0";
  }
  const pendiente = args.total_cents - args.pagado_cents;
  if (pendiente <= 0) return "La factura ya está totalmente cobrada";
  if (args.importe_cents > pendiente) {
    return `El cobro (${(args.importe_cents / 100).toFixed(2)} €) supera lo pendiente (${(pendiente / 100).toFixed(2)} €)`;
  }
  return null;
}
