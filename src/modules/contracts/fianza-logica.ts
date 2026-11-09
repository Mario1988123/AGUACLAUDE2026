/**
 * Lógica PURA de la fianza de un contrato (sin BD). La usan el cierre del
 * alquiler y el botón «Reintegrar fianza» de la ficha del contrato.
 *
 * Convenciones de conceptos en contract_payments (las de siempre):
 *  - "Fianza…"                         → fianza cobrada (validada o cobrada pendiente de validar).
 *  - "Devolución fianza"               → salida (importe negativo).
 *  - "Retención fianza (penalización)" → la empresa se la queda.
 */

export interface PagoFianza {
  concept: string;
  amount_cents: number;
  status: string;
}

export const CONCEPTO_DEVOLUCION_FIANZA = "Devolución fianza";
export const CONCEPTO_RETENCION_FIANZA = "Retención fianza (penalización)";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

export function resumenFianza(pagos: PagoFianza[]): {
  cobrada: number;
  devuelta: number;
  retenida: number;
  pendiente: number;
} {
  let cobrada = 0;
  let devuelta = 0;
  let retenida = 0;
  for (const p of pagos) {
    const c = norm(p.concept ?? "");
    if (c.startsWith("fianza")) {
      if (p.status === "validated" || p.status === "collected_pending_validation") {
        cobrada += p.amount_cents;
      }
    } else if (c.startsWith("devolucion fianza")) {
      if (p.status !== "cancelled") devuelta += Math.abs(p.amount_cents);
    } else if (c.startsWith("retencion fianza")) {
      if (p.status !== "cancelled") retenida += Math.abs(p.amount_cents);
    }
  }
  return { cobrada, devuelta, retenida, pendiente: Math.max(0, cobrada - devuelta - retenida) };
}

/** Estados de contrato en los que se decide la fianza pendiente (Mario 2026-11-09). */
export const ESTADOS_FIANZA_DECIDIBLE = ["completed", "cancelled"] as const;

export function fianzaDecidible(estado: string): boolean {
  return (ESTADOS_FIANZA_DECIDIBLE as readonly string[]).includes(estado);
}

export const MOTIVO_RETENCION_MIN = 5;

/** Motivo obligatorio para quedarse la fianza. */
export function validarMotivoRetencion(
  motivo: string | null | undefined,
): { ok: true; motivo: string } | { ok: false; error: string } {
  const m = (motivo ?? "").trim();
  if (m.length < MOTIVO_RETENCION_MIN) {
    return {
      ok: false,
      error: `Indica por qué nos quedamos la fianza (mínimo ${MOTIVO_RETENCION_MIN} caracteres)`,
    };
  }
  return { ok: true, motivo: m.slice(0, 1000) };
}

/**
 * Tras registrar una devolución o retención: si entre lo devuelto y lo
 * retenido se supera lo cobrado, otro envío se ha adelantado y el nuestro
 * sobra (hay que deshacerlo).
 */
export function fianzaExcedida(r: { cobrada: number; devuelta: number; retenida: number }): boolean {
  return r.devuelta + r.retenida > r.cobrada;
}
