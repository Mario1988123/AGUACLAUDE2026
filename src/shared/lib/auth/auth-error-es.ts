/**
 * Traducción de los errores de Supabase Auth al español.
 *
 * La app es solo para España y toda la interfaz está en español, pero
 * `supabase.auth.*` devuelve sus mensajes en inglés y las páginas de login /
 * recuperar / restablecer contraseña los pintaban tal cual. En el panel de
 * superadmin quedó registrado el caso real: un usuario vio
 * "No se pudo cambiar la contraseña — Password should be at least 6
 * characters." (2026-08-17).
 *
 * Supabase no expone estos mensajes traducidos ni un catálogo estable de
 * códigos para todos ellos, así que se hace por coincidencia de texto sobre
 * los mensajes conocidos, con reserva al original si aparece uno nuevo (mejor
 * un mensaje en inglés que uno genérico que no diga qué pasa).
 */

/** Longitud mínima de contraseña que exige Supabase Auth por defecto. */
export const MIN_PASSWORD_LENGTH = 6;

const EXACT: Record<string, string> = {
  "invalid login credentials": "Email o contraseña incorrectos.",
  "email not confirmed": "Tu email aún no está confirmado. Revisa tu bandeja de entrada.",
  "user already registered": "Ya existe una cuenta con ese email.",
  "user not found": "No hay ninguna cuenta con ese email.",
  "email rate limit exceeded":
    "Se han enviado demasiados correos. Espera unos minutos antes de volver a intentarlo.",
  "token has expired or is invalid":
    "El enlace ha caducado o ya se ha usado. Pide uno nuevo.",
  "new password should be different from the old password":
    "La contraseña nueva tiene que ser distinta de la anterior.",
  "auth session missing!":
    "Tu sesión ha caducado. Vuelve a entrar para continuar.",
  "signups not allowed for this instance":
    "El registro está desactivado. Pide a un administrador que te dé de alta.",
};

/** Patrones con datos variables dentro del mensaje. */
const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /password should be at least (\d+) characters/i,
    (m) => `La contraseña debe tener al menos ${m[1]} caracteres.`,
  ],
  [
    /for security purposes, you can only request this after (\d+) seconds?/i,
    (m) => `Por seguridad, espera ${m[1]} segundos antes de volver a intentarlo.`,
  ],
  [/rate limit/i, () => "Demasiados intentos. Espera un momento y vuelve a probar."],
  [/network|fetch failed/i, () => "No hay conexión con el servidor. Revisa tu red."],
];

/**
 * Devuelve el mensaje en español. Si no se reconoce, devuelve el original
 * (nunca una cadena vacía ni un "Error" genérico).
 */
export function authErrorEs(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "No se ha podido completar la operación.";

  const exact = EXACT[msg.toLowerCase().replace(/\.$/, "")];
  if (exact) return exact;

  for (const [re, build] of PATTERNS) {
    const m = msg.match(re);
    if (m) return build(m);
  }
  return msg;
}
