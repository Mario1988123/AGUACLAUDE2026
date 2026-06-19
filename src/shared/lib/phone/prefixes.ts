/**
 * Prefijos telefónicos europeos + utilidades de parseo/validación.
 *
 * Decisión 2026-06-19: el campo de teléfono pasa de ser solo España a admitir
 * prefijos de toda Europa. El número se guarda JUNTO al prefijo en el mismo
 * campo de texto (ej. "+34 612345678"), sin tocar la base de datos.
 *
 * Validación:
 *  · Prefijo +34 (España) o sin prefijo (legado) → estricto: 9 dígitos que
 *    empiezan por 6/7/8/9 (móvil o fijo).
 *  · Otro prefijo europeo → laxo: 6–14 dígitos (no conocemos las reglas de
 *    cada país y no queremos bloquear ventas por un falso "inválido").
 */

export interface PhonePrefix {
  /** Código de marcación con + (ej. "+34"). */
  code: string;
  /** ISO del país (solo informativo). */
  iso: string;
  /** Nombre en español. */
  name: string;
  /** Bandera emoji. */
  flag: string;
}

// España primero (mercado principal). El resto, alfabético por nombre.
export const EUROPE_PHONE_PREFIXES: PhonePrefix[] = [
  { code: "+34", iso: "ES", name: "España", flag: "🇪🇸" },
  { code: "+355", iso: "AL", name: "Albania", flag: "🇦🇱" },
  { code: "+49", iso: "DE", name: "Alemania", flag: "🇩🇪" },
  { code: "+376", iso: "AD", name: "Andorra", flag: "🇦🇩" },
  { code: "+43", iso: "AT", name: "Austria", flag: "🇦🇹" },
  { code: "+32", iso: "BE", name: "Bélgica", flag: "🇧🇪" },
  { code: "+375", iso: "BY", name: "Bielorrusia", flag: "🇧🇾" },
  { code: "+387", iso: "BA", name: "Bosnia y Herzegovina", flag: "🇧🇦" },
  { code: "+359", iso: "BG", name: "Bulgaria", flag: "🇧🇬" },
  { code: "+357", iso: "CY", name: "Chipre", flag: "🇨🇾" },
  { code: "+385", iso: "HR", name: "Croacia", flag: "🇭🇷" },
  { code: "+45", iso: "DK", name: "Dinamarca", flag: "🇩🇰" },
  { code: "+421", iso: "SK", name: "Eslovaquia", flag: "🇸🇰" },
  { code: "+386", iso: "SI", name: "Eslovenia", flag: "🇸🇮" },
  { code: "+372", iso: "EE", name: "Estonia", flag: "🇪🇪" },
  { code: "+358", iso: "FI", name: "Finlandia", flag: "🇫🇮" },
  { code: "+33", iso: "FR", name: "Francia", flag: "🇫🇷" },
  { code: "+350", iso: "GI", name: "Gibraltar", flag: "🇬🇮" },
  { code: "+30", iso: "GR", name: "Grecia", flag: "🇬🇷" },
  { code: "+36", iso: "HU", name: "Hungría", flag: "🇭🇺" },
  { code: "+353", iso: "IE", name: "Irlanda", flag: "🇮🇪" },
  { code: "+354", iso: "IS", name: "Islandia", flag: "🇮🇸" },
  { code: "+39", iso: "IT", name: "Italia", flag: "🇮🇹" },
  { code: "+383", iso: "XK", name: "Kosovo", flag: "🇽🇰" },
  { code: "+371", iso: "LV", name: "Letonia", flag: "🇱🇻" },
  { code: "+423", iso: "LI", name: "Liechtenstein", flag: "🇱🇮" },
  { code: "+370", iso: "LT", name: "Lituania", flag: "🇱🇹" },
  { code: "+352", iso: "LU", name: "Luxemburgo", flag: "🇱🇺" },
  { code: "+389", iso: "MK", name: "Macedonia del Norte", flag: "🇲🇰" },
  { code: "+356", iso: "MT", name: "Malta", flag: "🇲🇹" },
  { code: "+373", iso: "MD", name: "Moldavia", flag: "🇲🇩" },
  { code: "+377", iso: "MC", name: "Mónaco", flag: "🇲🇨" },
  { code: "+382", iso: "ME", name: "Montenegro", flag: "🇲🇪" },
  { code: "+47", iso: "NO", name: "Noruega", flag: "🇳🇴" },
  { code: "+31", iso: "NL", name: "Países Bajos", flag: "🇳🇱" },
  { code: "+48", iso: "PL", name: "Polonia", flag: "🇵🇱" },
  { code: "+351", iso: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "+44", iso: "GB", name: "Reino Unido", flag: "🇬🇧" },
  { code: "+420", iso: "CZ", name: "República Checa", flag: "🇨🇿" },
  { code: "+40", iso: "RO", name: "Rumanía", flag: "🇷🇴" },
  { code: "+7", iso: "RU", name: "Rusia", flag: "🇷🇺" },
  { code: "+378", iso: "SM", name: "San Marino", flag: "🇸🇲" },
  { code: "+381", iso: "RS", name: "Serbia", flag: "🇷🇸" },
  { code: "+46", iso: "SE", name: "Suecia", flag: "🇸🇪" },
  { code: "+41", iso: "CH", name: "Suiza", flag: "🇨🇭" },
  { code: "+90", iso: "TR", name: "Turquía", flag: "🇹🇷" },
  { code: "+380", iso: "UA", name: "Ucrania", flag: "🇺🇦" },
];

export const DEFAULT_PHONE_PREFIX = "+34";

// Códigos ordenados por longitud descendente para casar el prefijo más largo
// primero (ej. "+351" antes que cualquier "+3x"). Evita falsos positivos.
const CODES_BY_LENGTH = EUROPE_PHONE_PREFIXES.map((p) => p.code).sort(
  (a, b) => b.length - a.length,
);

/**
 * Separa un valor de teléfono en { code, national }. Acepta valores legados
 * sin prefijo ("612345678") y formato 00 internacional ("0034 612..."). Si no
 * reconoce el prefijo, asume España. Conserva los separadores que el usuario
 * escribió en la parte nacional (no rompe el tecleo).
 */
export function parsePhoneValue(value: string): { code: string; national: string } {
  const raw = (value ?? "").trim();
  if (!raw) return { code: DEFAULT_PHONE_PREFIX, national: "" };
  // 00xx (prefijo internacional con ceros) → +xx
  const work = raw.startsWith("00") ? `+${raw.slice(2)}` : raw;
  if (work.startsWith("+")) {
    for (const code of CODES_BY_LENGTH) {
      if (work.startsWith(code)) {
        // Quitamos el code y un único separador inicial (espacio/guion).
        const national = work.slice(code.length).replace(/^[\s-]+/, "");
        return { code, national };
      }
    }
    // Prefijo + no reconocido: lo tratamos como España y dejamos el resto.
    return { code: DEFAULT_PHONE_PREFIX, national: work.replace(/^\+/, "") };
  }
  return { code: DEFAULT_PHONE_PREFIX, national: raw };
}

/** Une prefijo + número en el valor que se guarda. Vacío si no hay número. */
export function combinePhoneValue(code: string, national: string): string {
  const n = (national ?? "").trim();
  return n ? `${code} ${n}` : "";
}

/**
 * Valida un teléfono que puede llevar prefijo europeo. España (o sin prefijo)
 * → estricto (9 dígitos 6/7/8/9). Resto de Europa → laxo (6–14 dígitos).
 */
export function validatePhoneWithPrefix(value: string): boolean {
  const { code, national } = parsePhoneValue(value);
  const digits = national.replace(/\D/g, "");
  if (!digits) return false;
  if (code === DEFAULT_PHONE_PREFIX) {
    return /^[6789]\d{8}$/.test(digits);
  }
  return /^\d{6,14}$/.test(digits);
}
