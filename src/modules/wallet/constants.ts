export const WALLET_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  collected: "Cobrado",
  pending_settlement: "Pdte. liquidar",
  settled: "Liquidado",
  validated: "Validado",
  rejected: "Rechazado",
};

export const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  financing: "Financiera",
};
