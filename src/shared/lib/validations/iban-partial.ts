import { validateIBAN } from "./spanish";

/**
 * Valida un IBAN parcial. Estados:
 *   - incomplete : aún no hay 24 chars
 *   - valid      : 24 chars y mod 97 OK
 *   - pending    : el usuario ha dejado "ES00" (placeholder pendiente, se
 *                  guarda y permite avanzar; el IBAN real se completa
 *                  antes/durante la firma del contrato)
 *   - invalid_dc : DC introducido no cuadra con BBAN
 *   - invalid    : formato roto
 */
export type IbanCheck =
  | { state: "incomplete" }
  | { state: "valid" }
  | { state: "pending" }
  | { state: "invalid_dc"; expected: string }
  | { state: "invalid" };

const PENDING_PLACEHOLDER = "ES00";

export function isPendingIban(value: string): boolean {
  const v = value?.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!v) return false;
  // Aceptamos "ES00" pelado o ES00 + ceros/espacios — todo equivale a
  // "todavía no tengo el IBAN, lo daré antes de firmar".
  if (v === PENDING_PLACEHOLDER) return true;
  if (v.startsWith(PENDING_PLACEHOLDER) && /^ES0+$/.test(v)) return true;
  return false;
}

export function checkIbanLive(value: string): IbanCheck {
  const v = value?.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!v || v.length < 4) return { state: "incomplete" };
  if (!/^[A-Z]{2}\d{2}/.test(v)) return { state: "invalid" };

  // Placeholder ES00 → estado especial "pending" (se podrá guardar)
  if (isPendingIban(v)) return { state: "pending" };

  const fullLen = v.startsWith("ES") ? 24 : 0;
  if (fullLen && v.length < fullLen) return { state: "incomplete" };

  const dc = v.slice(2, 4);

  if (fullLen && v.length === fullLen) {
    if (validateIBAN(v)) return { state: "valid" };
    // Calcular DC esperado para mostrarlo al usuario
    const country = v.slice(0, 2);
    const bban = v.slice(4);
    const rearranged = bban + country + "00";
    const expanded = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    let remainder = 0;
    for (let i = 0; i < expanded.length; i += 7) {
      remainder = parseInt(String(remainder) + expanded.slice(i, i + 7), 10) % 97;
    }
    const expected = String(98 - remainder).padStart(2, "0");
    if (dc === "00") return { state: "invalid_dc", expected };
    return { state: "invalid_dc", expected };
  }
  return { state: "incomplete" };
}
