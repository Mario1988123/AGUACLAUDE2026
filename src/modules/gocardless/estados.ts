/**
 * GoCardless: máquina de estados de un pago y clave de idempotencia
 * (lógica pura, sin BD). I24.
 *
 * Los webhooks de GoCardless pueden llegar desordenados o repetidos. Antes
 * se aplicaba cualquier evento tal cual: un `confirmed` que llegaba tarde
 * devolvía a "cobrado sin validar" un pago ya `paid_out`.
 */

/** Orden del camino feliz. */
const RANGO: Record<string, number> = {
  pending_customer_approval: 0,
  pending_submission: 0,
  submitted: 1,
  confirmed: 2,
  paid_out: 3,
};

/** Estados finales negativos y desde dónde se puede llegar a ellos. */
const NEGATIVOS: Record<string, string[]> = {
  failed: ["pending_customer_approval", "pending_submission", "submitted", "confirmed"],
  cancelled: ["pending_customer_approval", "pending_submission", "submitted"],
  customer_approval_denied: ["pending_customer_approval"],
  // Retrocesión: el banco del deudor devuelve un cobro ya cobrado.
  charged_back: ["confirmed", "paid_out"],
};

/**
 * ¿Se aplica el paso de `actual` a `nuevo`?
 *  · Hacia delante en el camino feliz: sí. Hacia atrás o igual: no.
 *  · A un estado negativo: solo desde los estados que lo permiten.
 *  · Un pago fallido que GoCardless reenvía (resubmission) vuelve a
 *    `submitted`: se permite salir de `failed` hacia `submitted`.
 */
export function transicionPagoGcPermitida(actual: string | null | undefined, nuevo: string): boolean {
  const a = actual ?? "pending_submission";
  if (a === nuevo) return false;
  if (nuevo in NEGATIVOS) return NEGATIVOS[nuevo]!.includes(a);
  if (!(nuevo in RANGO)) return false;
  if (a === "failed") return nuevo === "submitted";
  if (!(a in RANGO)) return false; // cancelled / charged_back son finales
  return RANGO[nuevo]! > RANGO[a]!;
}

/**
 * Clave de idempotencia determinista para crear un cobro en GoCardless.
 * Mismo cobro (empresa + mandato + lo que se cobra + importe + intento) →
 * misma clave → GoCardless devuelve el MISMO pago en vez de crear otro.
 * Antes era crypto.randomUUID(): un doble clic creaba dos cargos reales.
 *
 * Si no hay ni factura ni pago del contrato al que atar el cobro (cobro
 * suelto), devuelve null y el llamador decide.
 */
export function claveIdempotenciaCobro(args: {
  companyId: string;
  mandateId: string;
  invoiceId?: string | null;
  contractPaymentId?: string | null;
  importeCents: number;
  /** 0 = primer intento; cada reintento usa su número. */
  intento?: number;
}): string | null {
  const objetivo = args.contractPaymentId
    ? `cp:${args.contractPaymentId}`
    : args.invoiceId
      ? `inv:${args.invoiceId}`
      : null;
  if (!objetivo) return null;
  return [
    "hm",
    args.companyId,
    args.mandateId,
    objetivo,
    String(args.importeCents),
    `r${args.intento ?? 0}`,
  ].join(":");
}

/** Estados de un pago de GoCardless que siguen "vivos" (pueden acabar cobrando). */
export const ESTADOS_GC_VIVOS = [
  "pending_customer_approval",
  "pending_submission",
  "submitted",
  "confirmed",
  "paid_out",
] as const;
