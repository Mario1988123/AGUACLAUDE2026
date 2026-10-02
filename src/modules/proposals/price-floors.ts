/**
 * Suelos de precio de una propuesta (lógica pura, sin BD, para poder probarla).
 *
 * - `min_authorized_cents`: por debajo, la propuesta necesita aprobación de un
 *   nivel 1/2 (queda en `pending_approval`).
 * - `absolute_min_cents`: por debajo NO se puede vender, ni con aprobación.
 *   Auditoría 2026-10-01 (I27): el servidor recalculaba con los precios que
 *   manda el navegador y nunca aplicaba este suelo.
 *
 * [decide] El suelo absoluto solo se aplica al plan de CONTADO. En
 * renting/alquiler la línea lleva la CUOTA mensual, pero `absolute_min_cents`
 * se ancla al precio TOTAL al guardar el plan (pricing-actions.ts), así que
 * comparar cuota con total bloquearía propuestas legítimas: en producción hay
 * 4 planes de renting/alquiler con el absoluto por encima de la cuota.
 * [decide] Y solo cuando el absoluto es MENOR que el mínimo autorizado: si son
 * iguales es el valor que pone el panel por defecto, no un suelo elegido, y
 * bloquear ahí convertiría toda bajada de precio en un "no" sin aprobación.
 */

export type PricePlanRow = {
  product_id: string;
  plan_type: string;
  min_authorized_cents: number | null;
  absolute_min_cents?: number | null;
  duration_months: number | null;
};

export type PriceFloorResult = {
  requiresApproval: boolean;
  /** Primera línea por debajo del mínimo absoluto (solo contado), o null. */
  belowAbsolute: { product_id: string; unit_price_cents: number; min_cents: number } | null;
};

/** Elige, por producto, el plan de la duración pedida; si no hay, el primero. */
export function pickPlanByProduct(
  plans: PricePlanRow[],
  durationMonths: number | null | undefined,
): Map<string, PricePlanRow> {
  const byProduct = new Map<string, PricePlanRow>();
  for (const p of plans) {
    if (durationMonths && p.duration_months && p.duration_months === durationMonths) {
      byProduct.set(p.product_id, p);
    } else if (!byProduct.has(p.product_id)) {
      byProduct.set(p.product_id, p);
    }
  }
  return byProduct;
}

export function evaluatePriceFloors(
  items: Array<{ product_id: string; unit_price_cents: number }>,
  plans: PricePlanRow[],
  opts: { planType: string; durationMonths: number | null | undefined },
): PriceFloorResult {
  const byProduct = pickPlanByProduct(plans, opts.durationMonths);
  let requiresApproval = false;
  let belowAbsolute: PriceFloorResult["belowAbsolute"] = null;
  for (const it of items) {
    const p = byProduct.get(it.product_id);
    if (!p) continue;
    if (p.min_authorized_cents != null && it.unit_price_cents < p.min_authorized_cents) {
      requiresApproval = true;
    }
    if (
      !belowAbsolute &&
      opts.planType === "cash" &&
      p.absolute_min_cents != null &&
      p.absolute_min_cents > 0 &&
      // Solo si es un suelo PROPIO: cuando el panel de precios se guarda con
      // el absoluto vacío, lo ancla al mínimo autorizado (o al total), y ese
      // valor no es una decisión de nadie. En ese caso manda la aprobación.
      (p.min_authorized_cents == null || p.absolute_min_cents < p.min_authorized_cents) &&
      it.unit_price_cents < p.absolute_min_cents
    ) {
      belowAbsolute = {
        product_id: it.product_id,
        unit_price_cents: it.unit_price_cents,
        min_cents: p.absolute_min_cents,
      };
    }
  }
  return { requiresApproval, belowAbsolute };
}

/**
 * Estados desde los que se puede marcar una propuesta como ENVIADA.
 * [decide] Ni `pending_approval` (saltaría la aprobación) ni los terminales.
 * `sent` se admite para reenviar.
 */
export const PROPOSAL_SENDABLE_STATUSES = ["draft", "active", "sent"] as const;

/**
 * Estados desde los que se puede ACEPTAR una propuesta.
 * [decide] `draft` se admite (cliente que acepta en la visita sin envío
 * formal); `pending_approval` NO: primero tiene que aprobarla un nivel 1/2.
 */
export const PROPOSAL_ACCEPTABLE_STATUSES = ["draft", "active", "sent"] as const;

export function proposalStatusError(
  action: "send" | "accept",
  status: string,
): string | null {
  const allowed: readonly string[] =
    action === "send" ? PROPOSAL_SENDABLE_STATUSES : PROPOSAL_ACCEPTABLE_STATUSES;
  if (allowed.includes(status)) return null;
  if (status === "pending_approval") {
    return "La propuesta está pendiente de aprobación: tiene que validarla un responsable antes de enviarla o aceptarla.";
  }
  if (status === "accepted") return "La propuesta ya está aceptada.";
  return `La propuesta está en estado "${status}" y ya no se puede ${action === "send" ? "enviar" : "aceptar"}.`;
}
