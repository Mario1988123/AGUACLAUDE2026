import type { DedupeMatch } from "./check-dedupe";

export type PartyKind = "individual" | "company";

/**
 * REGLA (2026-09-07): una misma persona puede darse de alta ADEMÁS como
 * empresa (o al revés). Es la clienta de siempre, que ahora contrata con su
 * sociedad: nombre y CIF propios, pero comparte email y teléfono con su ficha
 * de particular. Por eso un choque de email o teléfono NO bloquea el alta
 * cuando el registro nuevo es de otro tipo de titular (particular ↔ empresa).
 *
 * El choque de DNI/CIF sigue bloqueando SIEMPRE: mismo número fiscal = mismo
 * titular, y ahí sí es un duplicado real (incluye el caso del autónomo, que es
 * party_kind=company pero reutiliza el DNI de la persona).
 */
export function isBlockingDuplicate(
  match: DedupeMatch,
  incomingPartyKind: PartyKind | null | undefined,
): boolean {
  if (match.field === "tax_id") return true;
  if (!incomingPartyKind) return true;
  return match.party_kind === incomingPartyKind;
}
