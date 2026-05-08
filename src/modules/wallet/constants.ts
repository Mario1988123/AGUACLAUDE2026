/**
 * Estados del wallet — significado conceptual:
 *
 * FLUJO ELECTRÓNICO (tarjeta, transferencia, bizum, SEPA, financiación):
 *  pending    → Sin cobrar.
 *  collected  → Comercial tiene justificante (datáfono / captura
 *               transferencia / captura bizum) — pero el dinero todavía
 *               no se ve en banco. Hay que esperar.
 *  validated  → Admin ha confirmado el ingreso en banco. Estado final.
 *
 * FLUJO EFECTIVO (cash) — el dinero NUNCA pasa por banco:
 *  pending             → Sin cobrar.
 *  pending_settlement  → Comercial cobró efectivo. Tiene el dinero en
 *                        mano y debe entregárselo al admin.
 *  settled             → Admin recibió el efectivo del comercial.
 *                        Estado final del flujo efectivo.
 *
 * COMUNES:
 *  rejected   → Admin lo ha rechazado (no llegó al banco, justificante
 *               incorrecto, error en datáfono…).
 *  cancelled  → Cancelado (el cliente nunca pagará).
 */
export const WALLET_STATUS_LABEL: Record<string, string> = {
  pending: "Sin cobrar",
  collected: "Cobrado · pdte. banco",
  pending_settlement: "Cobrado · pdte. liquidar",
  settled: "Liquidado al admin",
  validated: "Confirmado en banco",
  rejected: "Rechazado",
  cancelled: "Cancelado",
};

/**
 * Versión corta para badges donde no cabe el texto completo.
 */
export const WALLET_STATUS_SHORT: Record<string, string> = {
  pending: "Sin cobrar",
  collected: "Pdte. banco",
  pending_settlement: "Pdte. liquidar",
  settled: "Liquidado",
  validated: "En banco",
  rejected: "Rechazado",
  cancelled: "Cancelado",
};

export const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  financing: "Financiera",
};
