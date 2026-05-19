// =============================================================================
// validations/spanish.ts
// Validadores para datos españoles: DNI, NIE, CIF, IBAN, CP, teléfono.
// Usados con zod (ver schemas.ts) y desde forms.
// =============================================================================

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** Valida DNI (8 dígitos + letra). Devuelve la letra correcta si la dada es errónea. */
export function validateDNI(value: string): { valid: boolean; expectedLetter?: string } {
  const v = value?.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^\d{8}[A-Z]$/.test(v)) return { valid: false };
  const number = parseInt(v.slice(0, 8), 10);
  const expected = DNI_LETTERS[number % 23]!;
  return { valid: v[8] === expected, expectedLetter: expected };
}

/** Valida NIE (X/Y/Z + 7 dígitos + letra). */
export function validateNIE(value: string): { valid: boolean; expectedLetter?: string } {
  const v = value?.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[XYZ]\d{7}[A-Z]$/.test(v)) return { valid: false };
  const prefix = v[0]!;
  const map: Record<string, string> = { X: "0", Y: "1", Z: "2" };
  const number = parseInt(map[prefix]! + v.slice(1, 8), 10);
  const expected = DNI_LETTERS[number % 23]!;
  return { valid: v[8] === expected, expectedLetter: expected };
}

/** Valida DNI o NIE. */
export function validateDNIorNIE(value: string): { valid: boolean; expectedLetter?: string } {
  const v = value?.trim().toUpperCase();
  if (/^[XYZ]/.test(v)) return validateNIE(v);
  return validateDNI(v);
}

/**
 * Valida CIF/NIF de empresa de forma LAXA (sólo formato, no dígito de
 * control). Letras válidas según AEAT:
 *   A: SA           B: SL           C: Soc. colectiva
 *   D: Soc. comand. E: Com. bienes  F: Cooperativa
 *   G: Asociación   H: Com. propos. J: Soc. civil
 *   N: extranjera   P: corp. local  Q: organismo público
 *   R: religiosa    S: órgano admón. U: UTE
 *   V: otras        W: estab. permanente extranjero
 *
 * NOTA: el envío al servidor ya no rechaza por formato (admin responsable).
 * Esta función se usa para el indicador visual del input.
 */
export function validateCIF(value: string): boolean {
  const v = value?.trim().toUpperCase().replace(/[\s\-./()]/g, "");
  return /^[ABCDEFGHJNPQRSUVW]\d{7}[A-Z0-9]$/.test(v);
}

/** Valida IBAN español (ES + 22 dígitos) y otros IBAN europeos. */
export function validateIBAN(value: string): boolean {
  const v = value?.trim().toUpperCase().replace(/[\s\-./()]/g, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(v)) return false;

  // Mover los 4 primeros al final, convertir letras a números (A=10..Z=35)
  const rearranged = v.slice(4) + v.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // BigInt mod 97
  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    remainder = parseInt(String(remainder) + expanded.slice(i, i + 7), 10) % 97;
  }
  return remainder === 1;
}

/** Valida código postal español (5 dígitos, 01-52). */
export function validateSpanishPostalCode(value: string): boolean {
  const v = value?.trim();
  if (!/^\d{5}$/.test(v)) return false;
  const province = parseInt(v.slice(0, 2), 10);
  return province >= 1 && province <= 52;
}

/** Valida teléfono español: móvil (6/7) o fijo (8/9), 9 dígitos, opcional +34. */
export function validateSpanishPhone(value: string): boolean {
  const v = value?.trim().replace(/[\s\-\.()]/g, "").replace(/^\+34/, "").replace(/^0034/, "");
  return /^[6789]\d{8}$/.test(v);
}

/** Normaliza un teléfono español al formato +34XXXXXXXXX. */
export function normalizeSpanishPhone(value: string): string | null {
  if (!validateSpanishPhone(value)) return null;
  const clean = value.trim().replace(/[\s\-\.()]/g, "").replace(/^\+34/, "").replace(/^0034/, "");
  return `+34${clean}`;
}

/** Devuelve la provincia (nombre) por código postal español. */
export function provinceFromPostalCode(cp: string): string | null {
  if (!validateSpanishPostalCode(cp)) return null;
  const code = cp.slice(0, 2);
  return SPAIN_PROVINCES[code] ?? null;
}

const SPAIN_PROVINCES: Record<string, string> = {
  "01": "Álava",
  "02": "Albacete",
  "03": "Alicante",
  "04": "Almería",
  "05": "Ávila",
  "06": "Badajoz",
  "07": "Islas Baleares",
  "08": "Barcelona",
  "09": "Burgos",
  "10": "Cáceres",
  "11": "Cádiz",
  "12": "Castellón",
  "13": "Ciudad Real",
  "14": "Córdoba",
  "15": "A Coruña",
  "16": "Cuenca",
  "17": "Girona",
  "18": "Granada",
  "19": "Guadalajara",
  "20": "Guipúzcoa",
  "21": "Huelva",
  "22": "Huesca",
  "23": "Jaén",
  "24": "León",
  "25": "Lleida",
  "26": "La Rioja",
  "27": "Lugo",
  "28": "Madrid",
  "29": "Málaga",
  "30": "Murcia",
  "31": "Navarra",
  "32": "Ourense",
  "33": "Asturias",
  "34": "Palencia",
  "35": "Las Palmas",
  "36": "Pontevedra",
  "37": "Salamanca",
  "38": "Santa Cruz de Tenerife",
  "39": "Cantabria",
  "40": "Segovia",
  "41": "Sevilla",
  "42": "Soria",
  "43": "Tarragona",
  "44": "Teruel",
  "45": "Toledo",
  "46": "Valencia",
  "47": "Valladolid",
  "48": "Vizcaya",
  "49": "Zamora",
  "50": "Zaragoza",
  "51": "Ceuta",
  "52": "Melilla",
};
