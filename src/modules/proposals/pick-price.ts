import type { ProductForProposal } from "@/modules/products/actions";

/**
 * Devuelve true si el destinatario tributa como empresa o autónomo
 * (precio + IVA en la factura). false → particular (precio con IVA incluido).
 */
export function isBusinessParty(party: {
  party_kind?: "individual" | "company" | null;
  is_autonomo?: boolean | null;
} | null | undefined): boolean {
  if (!party) return false;
  if (party.party_kind === "company") return true;
  if (party.is_autonomo) return true;
  return false;
}

export interface PickedPrice {
  /** Cuota mensual elegida (€/mes) — null en contado. */
  monthly_cents: number | null;
  /** Total elegido — para contado es el PVP, para renting/rental es cuota × duración. */
  total_cents: number;
  /** Precisa IVA encima? true cuando viene del campo "business" (base). */
  needs_iva: boolean;
  /** Etiqueta para mostrar en UI/PDF: "IVA incluido" vs "Base imponible (+IVA)". */
  label: "IVA incluido" | "Base imponible";
}

/**
 * Elige el precio correcto del plan según el destinatario.
 *
 * Lógica:
 *  - Particular → `_individual_cents` (IVA incluido). Si no hay, fallback al
 *    legacy `total_price_cents`/`monthly_price_cents`.
 *  - Empresa/autónomo → `_business_cents` (BASE). Si no hay, fallback al
 *    legacy y AVISAMOS que falta precio empresa (devolvemos needs_iva=false
 *    porque el legacy ya viene "con IVA" probablemente). El admin debe
 *    rellenar el precio empresa cuanto antes.
 */
export function pickPrice(
  plan: ProductForProposal["plans"][number],
  destinatario: { party_kind?: "individual" | "company" | null; is_autonomo?: boolean | null } | null | undefined,
): PickedPrice {
  const isBusiness = isBusinessParty(destinatario);
  if (isBusiness) {
    const bizMonthly = plan.monthly_price_business_cents;
    const bizTotal = plan.total_price_business_cents;
    if (bizTotal != null || bizMonthly != null) {
      return {
        monthly_cents: bizMonthly,
        total_cents: bizTotal ?? (bizMonthly ?? 0) * (plan.duration_months ?? 1),
        needs_iva: true,
        label: "Base imponible",
      };
    }
    // Fallback al legacy/individual cuando no hay precio empresa configurado.
    return {
      monthly_cents:
        plan.monthly_price_individual_cents ?? plan.monthly_price_cents,
      total_cents:
        plan.total_price_individual_cents ?? plan.total_price_cents,
      needs_iva: false,
      label: "IVA incluido",
    };
  }
  // Particular
  return {
    monthly_cents:
      plan.monthly_price_individual_cents ?? plan.monthly_price_cents,
    total_cents:
      plan.total_price_individual_cents ?? plan.total_price_cents,
    needs_iva: false,
    label: "IVA incluido",
  };
}
