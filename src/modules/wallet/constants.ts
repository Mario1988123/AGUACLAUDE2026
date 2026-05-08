/**
 * Estados del wallet — significado conceptual:
 *
 *  pending             → Aún no cobrado. Ningún dinero ha cambiado de manos.
 *  collected           → El comercial ha cobrado (tiene justificante:
 *                        ticket del datáfono, recibo del cliente, captura
 *                        de transferencia/bizum). Falta que el admin
 *                        confirme que el dinero ha llegado al banco
 *                        (puede haber error en datáfono, transferencia
 *                        no realizada, etc.).
 *  pending_settlement  → Cobrado en EFECTIVO. El comercial tiene físicamente
 *                        el dinero y debe liquidarlo a la empresa.
 *  validated           → El admin ha confirmado que el dinero ESTÁ en banco.
 *                        Es el estado final de un cobro electrónico.
 *  settled             → Liquidado a la empresa (sólo para efectivo:
 *                        el comercial entregó el dinero).
 *  rejected            → El admin lo ha rechazado (no llegó al banco,
 *                        importe incorrecto, justificante ilegible…).
 *  cancelled           → Cancelado (el cliente nunca pagará).
 */
export const WALLET_STATUS_LABEL: Record<string, string> = {
  pending: "Sin cobrar",
  collected: "Cobrado · pdte. banco",
  pending_settlement: "Cobrado · pdte. liquidar",
  settled: "Liquidado",
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
