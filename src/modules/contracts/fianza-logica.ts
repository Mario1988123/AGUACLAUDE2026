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
