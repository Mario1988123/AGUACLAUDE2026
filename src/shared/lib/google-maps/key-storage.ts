/**
 * Cifrado de la API key de Google que el admin de empresa guarda en
 * modo `own_key`. Reutiliza la VERIFACTU_MASTER_KEY de entorno (admite
 * GMAPS_MASTER_KEY si en el futuro se quiere separar). Formato y
 * algoritmo idénticos a aes-gcm.ts: AES-256-GCM + base64.
 *
 * La key cifrada se guarda en `company_settings.gmaps_api_key_encrypted`
 * y SOLO se descifra en server-side al hacer llamadas a Google. Nunca
 * se devuelve al cliente.
 */

import { encryptString, decryptString } from "@/shared/lib/crypto/aes-gcm";

export function encryptGmapsKey(plain: string): string {
  return encryptString(plain.trim());
}

export function decryptGmapsKey(encrypted: string): string {
  return decryptString(encrypted);
}

/**
 * Devuelve la API key efectiva para una empresa dado su modo:
 *  · own_key    → la suya descifrada de BD.
 *  · shared_key → la de plataforma (env GOOGLE_MAPS_PLATFORM_SERVER_KEY).
 *  · disabled   → null.
 *
 * Esta función solo se usa server-side. El cliente NUNCA debe recibir
 * la key directamente — para Maps JS y Places Autocomplete usa el
 * endpoint /api/maps/client-key que verifica la sesión.
 */
export function resolveServerKey(args: {
  mode: "disabled" | "shared_key" | "own_key";
  encryptedKey: string | null;
}): string | null {
  if (args.mode === "disabled") return null;
  if (args.mode === "own_key") {
    if (!args.encryptedKey) return null;
    try {
      return decryptGmapsKey(args.encryptedKey);
    } catch {
      return null;
    }
  }
  // shared_key: preferimos la SERVER key (sin restricción referrer, ideal
  // para llamadas Node). Si el admin no la configuró, fallback a la
  // pública para que el reverse-geocode no falle silenciosamente. Si la
  // pública está restringida por referrer, Google devolverá 403 y
  // caeremos a Nominatim de todos modos — pero al menos lo intentamos.
  return (
    process.env.GOOGLE_MAPS_PLATFORM_SERVER_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ??
    null
  );
}

/**
 * Devuelve la API key efectiva para uso CLIENT-side (Maps JS, Places
 * Autocomplete). Misma lógica pero usa la pública si shared_key.
 *
 * NEXT_PUBLIC_GOOGLE_MAPS_KEY queda como public; debe estar restringida
 * por referrer en Google Cloud para que solo funcione desde tus dominios.
 */
export function resolveClientKey(args: {
  mode: "disabled" | "shared_key" | "own_key";
  encryptedKey: string | null;
}): string | null {
  if (args.mode === "disabled") return null;
  if (args.mode === "own_key") {
    if (!args.encryptedKey) return null;
    try {
      return decryptGmapsKey(args.encryptedKey);
    } catch {
      return null;
    }
  }
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? null;
}
