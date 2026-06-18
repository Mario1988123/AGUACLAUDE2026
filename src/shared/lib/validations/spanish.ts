// =============================================================================
// validations/spanish.ts
// Validadores para datos españoles: DNI, NIE, CIF, IBAN, CP, teléfono.
// Usados con zod (ver schemas.ts) y desde forms.
// =============================================================================

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/**
 * DNI "comodín" para ventas al contado en las que NO se pide el DNI real.
 * Se ACEPTA como válido (no salta el aviso de letra incorrecta) y NUNCA cuenta
 * como duplicado, así que puede repetirse en tantos clientes como haga falta.
 * Es una vía de escape acordada para esos casos concretos.
 */
export const PLACEHOLDER_TAX_ID = "12345678A";

/** Normaliza un tax_id (mayúsculas, sin espacios ni guiones). */
function normalizeTaxId(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
}

/** ¿Es el DNI comodín de venta al contado? */
export function isPlaceholderTaxId(value: string | null | undefined): boolean {
  return normalizeTaxId(value) === PLACEHOLDER_TAX_ID;
}

/** Valida DNI (8 dígitos + letra). Devuelve la letra correcta si la dada es errónea. */
export function validateDNI(value: string): { valid: boolean; expectedLetter?: string } {
  const v = value?.trim().toUpperCase().replace(/[\s-]/g, "");
  // DNI comodín de venta al contado: se admite siempre como válido.
  if (v === PLACEHOLDER_TAX_ID) return { valid: true };
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

// =============================================================================
// Tolerancia de nombres de provincia (Bizkaia/Vizcaya, A Coruña/La Coruña…)
// Google/OSM devuelven el nombre cooficial o una variante; nuestra tabla de
// CP usa el nombre oficial castellano. Antes el form comparaba letra por
// letra y saltaba un falso "Dirección incoherente" al geolocalizar.
// =============================================================================

/** Quita tildes y pasa a minúsculas para comparar de forma laxa. */
function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Cada grupo = variantes del MISMO sitio. La primera es la canónica.
const PROVINCE_ALIASES: string[][] = [
  ["Álava", "Araba"],
  ["Guipúzcoa", "Gipuzkoa"],
  ["Vizcaya", "Bizkaia"],
  ["A Coruña", "La Coruña", "Coruña"],
  ["Girona", "Gerona"],
  ["Lleida", "Lérida"],
  ["Islas Baleares", "Illes Balears", "Baleares", "Balears"],
  ["Ourense", "Orense"],
  ["Las Palmas", "Las Palmas de Gran Canaria"],
  ["Santa Cruz de Tenerife", "Tenerife"],
  ["Castellón", "Castelló"],
  ["Valencia", "València"],
  ["Alicante", "Alacant"],
  ["Navarra", "Nafarroa"],
];

// variante normalizada → canónica normalizada
const PROVINCE_CANONICAL = new Map<string, string>();
for (const group of PROVINCE_ALIASES) {
  const canonical = stripDiacritics(group[0]!);
  for (const name of group) PROVINCE_CANONICAL.set(stripDiacritics(name), canonical);
}

/** Normaliza un nombre de provincia: quita prefijos ("Provincia de…",
 *  "Comunidad de…"), tildes y resuelve alias cooficiales a su canónico. */
export function normalizeProvinceName(value: string): string {
  let v = stripDiacritics(value ?? "");
  v = v
    .replace(
      /^(provincia de la |provincia de |province of |provincia |provincia de l'|comunidad foral de |comunidad de |comunitat de |principado de |principat d'|principat de )/,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return PROVINCE_CANONICAL.get(v) ?? v;
}

/** ¿Dos nombres de provincia se refieren al mismo sitio? Si alguno está
 *  vacío devuelve true (no podemos afirmar que se contradigan). Tolera
 *  variantes cooficiales y de grafía. */
export function provincesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a ?? "").trim();
  const nb = (b ?? "").trim();
  if (!na || !nb) return true;
  return normalizeProvinceName(na) === normalizeProvinceName(nb);
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
