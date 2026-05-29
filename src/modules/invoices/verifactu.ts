/**
 * Helpers Verifactu — implementa Reglamento Verifactu (RD 1007/2023 +
 * Orden HAC/1177/2024).
 *
 * Encapsula:
 *  · Cálculo del hash SHA-256 encadenado entre registros.
 *  · Generación de la URL del QR según especificación AEAT.
 *  · Estructura del payload del registro (RegistroFacturacionAlta).
 *
 * NO implementa todavía:
 *  · Firma XAdES con certificado FNMT (modo NO VERI*FACTU).
 *  · Envío SOAP a sede AEAT (cola separada).
 */

import crypto from "node:crypto";

/** URL base del servicio de cotejo público AEAT (modo Verifactu). */
const QR_BASE_URL =
  "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR";
const QR_BASE_URL_TEST =
  "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR";

export interface VerifactuRecordInput {
  /** NIF del emisor (la empresa). */
  issuer_nif: string;
  /** Código de la serie (ej. "A", "FAC"). */
  series_code: string;
  /** Número correlativo dentro de la serie. */
  invoice_number: number;
  /** Tipo de factura F1/F2/F3/R1-R5. */
  invoice_type: string;
  /** Fecha de expedición. */
  issued_at: Date;
  /** Fecha de operación (puede ser distinta). */
  operation_date: Date;
  /** Importe total con IVA, en céntimos. */
  total_cents: number;
  /** Cuota total de IVA (suma de cuotas de todos los tipos), en céntimos.
   *  Si no se pasa, se usa total_cents como fallback (huella incorrecta
   *  pero compatible con la versión anterior — ver fix 2026-05-30). */
  tax_cents?: number;
  /** Hash del registro INMEDIATAMENTE anterior (cadena). Vacío "" en el primero. */
  prev_hash: string;
  /** Tipo de registro: alta o anulación. */
  record_type: "alta" | "anulacion";
}

/**
 * Calcula el hash SHA-256 hex en mayúsculas del registro Verifactu.
 *
 * Según especificación AEAT, el hash se calcula sobre la concatenación
 * de campos en orden FIJO separados por `&`, terminada en `&` final.
 * Los campos:
 *   IDEmisorFactura=NIF
 *   NumSerieFactura=NumSerie
 *   FechaExpedicionFactura=DD-MM-YYYY
 *   TipoFactura=F1
 *   CuotaTotal=99.99
 *   ImporteTotal=999.99
 *   Huella=<prev_hash>
 *   FechaHoraHusoGenRegistro=YYYY-MM-DDTHH:MM:SSZ
 */
export function computeVerifactuHash(input: VerifactuRecordInput): string {
  const fechaExp = formatDateDDMMYYYY(input.issued_at);
  const totalEur = (input.total_cents / 100).toFixed(2);
  // CuotaTotal es la cuota de IVA agregada, NO el total con IVA. Si no nos lo
  // pasan (callers antiguos) caemos al total como fallback compat: la huella
  // no será la que AEAT recalcula, pero no rompe el flujo local.
  const taxEur = ((input.tax_cents ?? input.total_cents) / 100).toFixed(2);

  const concat =
    `IDEmisorFactura=${input.issuer_nif}` +
    `&NumSerieFactura=${input.series_code}-${input.invoice_number}` +
    `&FechaExpedicionFactura=${fechaExp}` +
    `&TipoFactura=${input.invoice_type}` +
    `&CuotaTotal=${taxEur}` +
    `&ImporteTotal=${totalEur}` +
    `&Huella=${input.prev_hash || ""}` +
    `&FechaHoraHusoGenRegistro=${input.issued_at.toISOString()}` +
    `&`;

  const hash = crypto.createHash("sha256").update(concat, "utf8").digest("hex");
  return hash.toUpperCase();
}

/**
 * Construye la URL del QR según especificación oficial AEAT.
 * El usuario escanea con el móvil → AEAT muestra los datos de la
 * factura registrada en su sistema (cotejo público).
 *
 * Parámetros (URL-encoded):
 *   nif     = NIF del emisor
 *   numserie = serie + número, ej "A/2026/1"
 *   fecha   = DD-MM-YYYY
 *   importe = total con dos decimales
 */
export function buildVerifactuQrUrl(input: {
  issuer_nif: string;
  series_code: string;
  invoice_number: number;
  issued_at: Date;
  total_cents: number;
  test?: boolean;
}): string {
  const params = new URLSearchParams({
    nif: input.issuer_nif,
    numserie: `${input.series_code}/${input.invoice_number}`,
    fecha: formatDateDDMMYYYY(input.issued_at),
    importe: (input.total_cents / 100).toFixed(2),
  });
  const base = input.test ? QR_BASE_URL_TEST : QR_BASE_URL;
  return `${base}?${params.toString()}`;
}

/**
 * Formato de fecha DD-MM-YYYY que exige la especificación.
 */
function formatDateDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Texto legal obligatorio que debe aparecer en la factura PDF cuando
 * el sistema opera en modo VERI*FACTU.
 */
export const VERIFACTU_LEGAL_TEXT =
  "Factura verificable en la sede electrónica de la AEAT. Sistema de Facturación Verificable (Verifactu).";

export const NO_VERIFACTU_LEGAL_TEXT =
  "Factura emitida por sistema informático de facturación conforme al Reglamento RD 1007/2023.";
