import { validateIBAN } from "./spanish";

/**
 * Valida un IBAN parcial: si tiene >= 6 caracteres (ES + 2 DC + arranque),
 * comprueba que los dígitos de control (posiciones 3-4) sean coherentes con
 * el resto introducido hasta ese momento. Para IBAN español devolvemos:
 *   - { state: "incomplete" }   si aún no hay 24 chars
 *   - { state: "valid" }        si los 24 chars validan mod 97
 *   - { state: "invalid_dc" }   si los DC no son ES00 ni cuadran con BBAN
 *   - { state: "invalid" }      si formato roto
 *
 * Política UI según indicación: si los 4 primeros NO son ES00 (es decir, el
 * usuario ha tecleado los DC reales), comprobar mod 97 cuando esté completo.
 */
export type IbanCheck =
  | { state: "incomplete" }
  | { state: "valid" }
  | { state: "invalid_dc"; expected: string }
  | { state: "invalid" };

export function checkIbanLive(value: string): IbanCheck {
  const v = value?.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!v || v.length < 4) return { state: "incomplete" };
  if (!/^[A-Z]{2}\d{2}/.test(v)) return { state: "invalid" };

  // ES debe tener 24 chars
  const fullLen = v.startsWith("ES") ? 24 : 0;
  if (fullLen && v.length < fullLen) return { state: "incomplete" };

  // Si los DC son "00", el usuario los está dejando como placeholder
  // → no comprobamos hasta tener BBAN completo y ofrecemos calcular
  const dc = v.slice(2, 4);

  if (fullLen && v.length === fullLen) {
    if (validateIBAN(v)) return { state: "valid" };
    // Calcular DC esperado
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
