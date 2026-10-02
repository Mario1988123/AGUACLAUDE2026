/**
 * Transformación factura del CRM → cuerpo JSON de la API de Verifacti.
 *
 * Lógica PURA (sin BD, sin red, sin "use server"): la usan el envío real
 * (./verifacti-envio.ts) y los tests (./verifacti-mapeo.test.ts).
 *
 * Fuente: especificación OpenAPI publicada por Verifacti
 *   https://www.verifacti.com/openapi/verifactu.yaml  (leída el 02-10-2026)
 *   https://www.verifacti.com/docs                     (misma especificación)
 *
 * Reglas de la API que se aplican aquí (todas citadas de esa especificación):
 *  · Importes en EUROS como string con punto decimal y hasta 2 decimales,
 *    patrón `(\+|-)?\d{1,12}(\.\d{0,2})?`. Se admiten negativos.
 *  · Fechas `DD-MM-AAAA`. `fecha_expedicion` DEBE ser la fecha actual
 *    (código de error `vf-verifactu-fecha_expedicion_hoy`).
 *  · `lineas` NO son las líneas de producto: es el desglose por tipo de IVA
 *    (`base_imponible`, `tipo_impositivo`, `cuota_repercutida`), máximo 12.
 *  · `importe_total` = suma de base + cuota (+ recargo) de las líneas
 *    (Verifacti tolera ±10 €; aquí se exige exacto).
 *  · `nif` del destinatario: exactamente 9 caracteres; obligatorio salvo
 *    F2/R5 o si se envía `id_otro`.
 *  · `tipo_impositivo` de IVA solo admite 0, 2, 4, 5, 7.5, 10 y 21.
 *  · Rectificativa por diferencias: `tipo_factura` R1..R4, `tipo_rectificativa`
 *    = "I", importes en negativo y `facturas_rectificadas` (opcional) con
 *    serie, número y fecha de la original.
 *  · Serie + número no pueden superar 60 caracteres; la serie no puede
 *    empezar por espacio. AEAT recibe la concatenación serie+número.
 */

import { createHash } from "node:crypto";

// ─── Tipos de entrada ────────────────────────────────────────────────────────

export interface LineaFacturaCrm {
  description: string;
  /** Base imponible de la línea, en céntimos (con signo). */
  subtotal_cents: number;
  /** Cuota de IVA de la línea, en céntimos (con signo). */
  tax_cents: number;
  tax_rate_percent: number;
  is_exempt?: boolean | null;
  /** Causa de exención AEAT: E1..E6 (IVA). */
  exempt_reason?: string | null;
  is_reverse_charge?: boolean | null;
}

export interface FacturaCrmParaVerifacti {
  kind: "invoice" | "credit_note";
  full_reference: string;
  /** "AAAA-MM-DD" (fecha de expedición guardada en el CRM). */
  issue_date: string;
  is_simplified?: boolean | null;
  description?: string | null;
  notes?: string | null;
  subtotal_cents: number;
  tax_cents: number;
  cliente: {
    nombre: string;
    nif: string | null;
    /** ISO 3166-1 alfa-2. Por defecto ES. */
    pais: string | null;
  };
  lineas: LineaFacturaCrm[];
  /** Solo rectificativas: la factura original. */
  rectificada?: { full_reference: string; issue_date: string } | null;
}

export type TipoFacturaVerifacti = "F1" | "F2" | "R1" | "R4" | "R5";

export interface LineaVerifacti {
  base_imponible: string;
  tipo_impositivo?: string;
  cuota_repercutida?: string;
  operacion_exenta?: string;
  calificacion_operacion?: "S1" | "S2";
}

export interface CuerpoAltaVerifacti {
  serie: string;
  numero: string;
  fecha_expedicion: string;
  tipo_factura: TipoFacturaVerifacti;
  descripcion: string;
  lineas: LineaVerifacti[];
  importe_total: string;
  nif?: string;
  nombre?: string;
  id_otro?: { codigo_pais: string; id_type: "02" | "04"; id: string };
  tipo_rectificativa?: "I";
  facturas_rectificadas?: Array<{ serie: string; numero: string; fecha_expedicion: string }>;
}

export interface CuerpoAnulacionVerifacti {
  serie: string;
  numero: string;
  fecha_expedicion: string;
}

export type ResultadoMapeo<T> = { ok: true; cuerpo: T } | { ok: false; error: string };

// ─── Utilidades de formato ───────────────────────────────────────────────────

/** Céntimos (entero con signo) → "1234.56" / "-1234.56". Sin coma flotante. */
export function centimosAImporte(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`Importe en céntimos no entero: ${cents}`);
  }
  const signo = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const resto = String(abs % 100).padStart(2, "0");
  return `${signo}${euros}.${resto}`;
}

/** "2026-10-03" (o ISO con hora) → "03-10-2026". */
export function fechaVerifacti(isoFecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoFecha ?? "");
  if (!m) throw new Error(`Fecha no válida: ${isoFecha}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Tipo de IVA → string sin ceros sobrantes ("21", "7.5", "10"). */
export function tipoImpositivoTexto(pct: number): string {
  return String(Math.round(Number(pct) * 100) / 100);
}

const TIPOS_IVA_VALIDOS = new Set(["0", "2", "4", "5", "7.5", "10", "21"]);

/**
 * Parte la referencia del CRM ("F-2026-00012") en serie y número para
 * Verifacti. La serie conserva el guion final ("F-2026-") para que la
 * concatenación serie+número que recibe la AEAT (y que sale en el QR) sea
 * EXACTAMENTE la referencia impresa en la factura.
 */
export function separarSerieNumero(fullReference: string): { serie: string; numero: string } {
  const ref = (fullReference ?? "").trim();
  const i = ref.lastIndexOf("-");
  if (i <= 0 || i === ref.length - 1) return { serie: "", numero: ref };
  return { serie: ref.slice(0, i + 1), numero: ref.slice(i + 1) };
}

/** Quita espacios, guiones, puntos y el prefijo "ES"; pasa a mayúsculas. */
export function normalizarNif(nif: string | null | undefined): string | null {
  if (!nif) return null;
  let n = nif.toUpperCase().replace(/[\s.\-_/]/g, "");
  if (n.length === 11 && n.startsWith("ES")) n = n.slice(2);
  return n || null;
}

/** Formatos oficiales que pide Verifacti: L+7D+L, 8D+L o L+8D. */
export function nifFormatoValido(nif: string): boolean {
  return /^([A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z]|[A-Z]\d{8})$/.test(nif);
}

const PAISES_UE = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "GR", "FI", "FR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

function normalizarPais(p: string | null | undefined): string {
  const v = (p ?? "").trim().toUpperCase();
  if (!v || v === "ESPAÑA" || v === "ESPANA" || v === "SPAIN") return "ES";
  return v.length === 2 ? v : "ES";
}

// ─── Desglose por tipo de IVA ────────────────────────────────────────────────

interface GrupoDesglose {
  clave: string;
  base: number;
  cuota: number;
  tipo: string | null;
  exenta: string | null;
  inversion: boolean;
}

/**
 * Agrupa las líneas de producto por tratamiento fiscal (tipo de IVA,
 * exención, inversión del sujeto pasivo). Verifacti pide una "línea" por
 * cada tratamiento y admite como máximo 12.
 */
export function agruparDesglose(
  lineas: LineaFacturaCrm[],
): { ok: true; grupos: GrupoDesglose[] } | { ok: false; error: string } {
  const mapa = new Map<string, GrupoDesglose>();
  for (const l of lineas) {
    const base = Number(l.subtotal_cents ?? 0);
    const cuota = Number(l.tax_cents ?? 0);
    if (!Number.isInteger(base) || !Number.isInteger(cuota)) {
      return { ok: false, error: `La línea «${l.description}» tiene importes no válidos.` };
    }
    let clave: string;
    let grupo: Omit<GrupoDesglose, "base" | "cuota">;
    if (l.is_exempt) {
      const causa = (l.exempt_reason ?? "").trim().toUpperCase();
      if (!/^E[1-6]$/.test(causa)) {
        return {
          ok: false,
          error: `La línea «${l.description}» está exenta de IVA pero no indica la causa (E1 a E6) que exige la AEAT.`,
        };
      }
      if (cuota !== 0) {
        return { ok: false, error: `La línea exenta «${l.description}» no puede llevar cuota de IVA.` };
      }
      clave = `E:${causa}`;
      grupo = { clave, tipo: null, exenta: causa, inversion: false };
    } else {
      const tipo = tipoImpositivoTexto(l.tax_rate_percent);
      if (!TIPOS_IVA_VALIDOS.has(tipo)) {
        return {
          ok: false,
          error: `El tipo de IVA ${tipo} % de la línea «${l.description}» no lo admite la AEAT (0, 2, 4, 5, 7,5, 10 o 21 %).`,
        };
      }
      const inversion = !!l.is_reverse_charge;
      if (inversion && cuota !== 0) {
        return {
          ok: false,
          error: `La línea «${l.description}» es con inversión del sujeto pasivo y no puede llevar cuota de IVA.`,
        };
      }
      clave = `${inversion ? "S2" : "S1"}:${tipo}`;
      grupo = { clave, tipo, exenta: null, inversion };
    }
    const g = mapa.get(clave) ?? { ...grupo, base: 0, cuota: 0 };
    g.base += base;
    g.cuota += cuota;
    mapa.set(clave, g);
  }
  const grupos = [...mapa.values()];
  if (grupos.length === 0) return { ok: false, error: "La factura no tiene líneas." };
  if (grupos.length > 12) {
    return {
      ok: false,
      error: "La factura mezcla más de 12 tratamientos de IVA distintos; la AEAT admite como máximo 12.",
    };
  }
  return { ok: true, grupos };
}

function grupoALinea(g: GrupoDesglose): LineaVerifacti {
  if (g.exenta) {
    return { base_imponible: centimosAImporte(g.base), operacion_exenta: g.exenta };
  }
  const linea: LineaVerifacti = {
    base_imponible: centimosAImporte(g.base),
    tipo_impositivo: g.tipo ?? "0",
    cuota_repercutida: centimosAImporte(g.cuota),
  };
  if (g.inversion) linea.calificacion_operacion = "S2";
  return linea;
}

// ─── Cuerpos ─────────────────────────────────────────────────────────────────

/**
 * Construye el cuerpo de POST /verifactu/create.
 *
 * `hoy` = fecha actual en Madrid ("AAAA-MM-DD"). Si la fecha de expedición
 * de la factura no es hoy, NO se envía: Verifacti la rechazaría
 * (`vf-verifactu-fecha_expedicion_hoy`) y además el PDF mostraría otra fecha.
 */
export function construirCuerpoAlta(
  f: FacturaCrmParaVerifacti,
  hoy: string,
): ResultadoMapeo<CuerpoAltaVerifacti> {
  if (f.kind !== "invoice" && f.kind !== "credit_note") {
    return { ok: false, error: "Solo se registran facturas y rectificativas." };
  }
  if ((f.issue_date ?? "").slice(0, 10) !== hoy) {
    return {
      ok: false,
      error: `La factura tiene fecha ${fechaVerifacti(f.issue_date)} y VeriFactu (Verifacti) solo admite registrar facturas con la fecha de hoy (${fechaVerifacti(hoy)}). Una factura emitida otro día ya no se puede registrar por esta vía: consúltalo con tu asesor.`,
    };
  }

  const { serie, numero } = separarSerieNumero(f.full_reference);
  if (!numero) return { ok: false, error: "La factura no tiene número." };
  if ((serie + numero).length > 60) {
    return { ok: false, error: "La serie y el número juntos superan los 60 caracteres que admite la AEAT." };
  }
  if (/^\s/.test(serie)) return { ok: false, error: "La serie no puede empezar por un espacio." };

  const desglose = agruparDesglose(f.lineas);
  if (!desglose.ok) return desglose;
  const baseTotal = desglose.grupos.reduce((s, g) => s + g.base, 0);
  const cuotaTotal = desglose.grupos.reduce((s, g) => s + g.cuota, 0);
  if (baseTotal !== f.subtotal_cents || cuotaTotal !== f.tax_cents) {
    return {
      ok: false,
      error: `Las líneas no cuadran con los totales de la factura (base ${centimosAImporte(baseTotal)} € frente a ${centimosAImporte(f.subtotal_cents)} €, IVA ${centimosAImporte(cuotaTotal)} € frente a ${centimosAImporte(f.tax_cents)} €). Revisa la factura antes de registrarla.`,
    };
  }

  const esRectificativa = f.kind === "credit_note";
  if (esRectificativa && baseTotal + cuotaTotal >= 0) {
    return { ok: false, error: "Una rectificativa por diferencias debe tener importe negativo." };
  }
  if (!esRectificativa && baseTotal + cuotaTotal < 0) {
    return { ok: false, error: "Una factura ordinaria no puede tener importe negativo." };
  }

  const simplificada = !!f.is_simplified;
  // [decide] Rectificativa = R1 (art. 80.1 y 80.2 LIVA y error fundado en
  // derecho), igual que create-core.ts. Simplificada → F2 / R5.
  const tipo: TipoFacturaVerifacti = esRectificativa
    ? simplificada
      ? "R5"
      : "R1"
    : simplificada
      ? "F2"
      : "F1";

  const descripcionBase =
    (f.description ?? "").trim() ||
    (esRectificativa && f.rectificada
      ? `Rectificación por diferencias de la factura ${f.rectificada.full_reference}`
      : "") ||
    f.lineas
      .map((l) => (l.description ?? "").trim())
      .filter(Boolean)
      .join("; ") ||
    (f.notes ?? "").trim() ||
    `Factura ${f.full_reference}`;

  const cuerpo: CuerpoAltaVerifacti = {
    serie,
    numero,
    fecha_expedicion: fechaVerifacti(f.issue_date),
    tipo_factura: tipo,
    descripcion: descripcionBase.slice(0, 500),
    lineas: desglose.grupos.map(grupoALinea),
    importe_total: centimosAImporte(baseTotal + cuotaTotal),
  };

  // Destinatario
  if (!simplificada) {
    const nombre = (f.cliente.nombre ?? "").trim().slice(0, 120);
    if (!nombre) return { ok: false, error: "Falta el nombre o la razón social del cliente." };
    const pais = normalizarPais(f.cliente.pais);
    const nif = normalizarNif(f.cliente.nif);
    if (!nif) {
      return {
        ok: false,
        error: "El cliente no tiene NIF. La AEAT no admite una factura completa sin NIF del destinatario: añádelo en la ficha del cliente o emítela como simplificada.",
      };
    }
    cuerpo.nombre = nombre;
    if (pais === "ES") {
      if (!nifFormatoValido(nif)) {
        return { ok: false, error: `El NIF del cliente (${nif}) no tiene un formato válido de 9 caracteres.` };
      }
      cuerpo.nif = nif;
    } else {
      cuerpo.id_otro = {
        codigo_pais: pais,
        // 02 = NIF-IVA (intracomunitario), 04 = identificador en el país de residencia.
        id_type: PAISES_UE.has(pais) ? "02" : "04",
        id: nif.slice(0, 20),
      };
    }
  }

  if (esRectificativa) {
    cuerpo.tipo_rectificativa = "I";
    if (f.rectificada?.full_reference && f.rectificada.issue_date) {
      const o = separarSerieNumero(f.rectificada.full_reference);
      cuerpo.facturas_rectificadas = [
        { serie: o.serie, numero: o.numero, fecha_expedicion: fechaVerifacti(f.rectificada.issue_date) },
      ];
    }
  }

  return { ok: true, cuerpo };
}

/** Cuerpo de POST /verifactu/cancel (anulación de un registro aceptado). */
export function construirCuerpoAnulacion(f: {
  full_reference: string;
  issue_date: string;
}): CuerpoAnulacionVerifacti {
  const { serie, numero } = separarSerieNumero(f.full_reference);
  return { serie, numero, fecha_expedicion: fechaVerifacti(f.issue_date) };
}

/**
 * Clave para la cabecera `Idempotency-Key`. Determinista: el mismo cuerpo
 * para la misma factura y operación da SIEMPRE la misma clave, así que un
 * doble clic o un reintento tras un corte de red devuelven la respuesta
 * original sin crear otro registro (Verifacti la recuerda 24 h por NIF).
 * Si cambian los datos, cambia la clave (Verifacti exige clave nueva para
 * un cuerpo distinto: 422 si se reutiliza).
 */
export function claveIdempotencia(
  operacion: "alta" | "anulacion",
  invoiceId: string,
  cuerpo: unknown,
): string {
  const hash = createHash("sha256").update(JSON.stringify(cuerpo)).digest("hex").slice(0, 32);
  return `crm-${operacion}-${invoiceId}-${hash}`;
}

// ─── Errores ─────────────────────────────────────────────────────────────────

/** Traduce la respuesta de error de Verifacti a un mensaje claro en español. */
export function mensajeErrorVerifacti(status: number, raw: unknown): string {
  const r = (raw ?? {}) as { error?: string; message?: string; codigo?: string };
  if (status === 401 || status === 403) {
    return "Verifacti no acepta la API key. Revisa la clave del NIF en Configuración → Facturación.";
  }
  if (status === 409) {
    return "Verifacti aún está procesando un envío idéntico de esta factura. Espera unos segundos y consulta el estado.";
  }
  if (status === 422) {
    return "Verifacti ya recibió esta factura con otros datos en las últimas 24 horas. Consulta su estado antes de reenviarla.";
  }
  if (status === 400) {
    const detalle = r.error ?? r.message ?? "datos no válidos";
    if (r.codigo === "vf-verifactu-factura_duplicada") {
      return "Esta factura ya está registrada en VeriFactu (misma serie, número y fecha).";
    }
    return `Verifacti rechazó la factura: ${detalle}${r.codigo ? ` (${r.codigo})` : ""}. No se ha enviado nada a la AEAT.`;
  }
  if (status === 404) return "Verifacti no encuentra el registro.";
  if (status >= 500) {
    return "Verifacti tuvo un error interno y no registró la factura. Vuelve a intentarlo en unos minutos.";
  }
  return `Verifacti respondió con un código inesperado (${status}).`;
}
