/**
 * Traducción de una excepción a mensaje para los wrappers `*SafeAction`.
 *
 * Sustituye al patrón que estaba copiado en 343 sitios:
 *
 *     catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Error" }; }
 *
 * Ese patrón tenía DOS problemas, ambos vistos en los reportes de error del
 * panel de superadmin (2026-08-28):
 *
 *  1. **Se tragaba el control de flujo de Next.** `requireSession()` llama a
 *     `redirect("/login")` cuando la sesión ha caducado, y `redirect()`
 *     funciona LANZANDO una excepción especial. Al capturarla, en vez de ir al
 *     login el usuario veía un toast "No se pudo eliminar — Error" y se
 *     quedaba atascado sin entender nada. Lo mismo con `notFound()`.
 *     Estas excepciones DEBEN propagarse.
 *
 *  2. **Degradaba a la cadena literal "Error"**, que no dice absolutamente
 *     nada ni al usuario ni a quien luego mira el reporte. Ahora se registra
 *     el valor real en el log del servidor y se devuelve lo que se pueda
 *     extraer de él.
 */

/**
 * ¿Es una excepción de control de flujo de Next (redirect / notFound)?
 * Next las marca con la propiedad `digest`.
 */
export function isNextControlFlowError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const digest = (e as { digest?: unknown }).digest;
  if (typeof digest === "string") {
    if (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND") return true;
  }
  const msg = (e as { message?: unknown }).message;
  return typeof msg === "string" && (msg === "NEXT_REDIRECT" || msg === "NEXT_NOT_FOUND");
}

/**
 * Extrae un texto legible de cualquier valor lanzado, SIN efectos (no relanza
 * ni registra). Sirve para logs y telemetría: un PostgrestError de Supabase es
 * un objeto plano (no `instanceof Error`) y `String(e)` lo dejaba en
 * "[object Object]" (visto en cron_runs de voice-retention, auditoría
 * 2026-10-01 I2).
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const partes: string[] = [];
    for (const v of [o.message, o.details, o.hint]) {
      if (typeof v === "string" && v.trim()) partes.push(v.trim());
    }
    if (partes.length > 0) {
      const code = typeof o.code === "string" && o.code ? ` (${o.code})` : "";
      return partes.join(" · ") + code;
    }
    try {
      const json = JSON.stringify(e);
      if (json && json !== "{}") return json;
    } catch {
      /* referencias circulares: seguimos */
    }
  }
  return String(e);
}

/**
 * Ejecuta `fn` y convierte cualquier excepción en `{ ok: false, error }`.
 *
 * Por qué: en producción Next oculta el mensaje de cualquier excepción que
 * salga de una server action y el usuario ve un genérico ("Algo ha fallado en
 * el servidor"), incluido el texto amable de parseOrFriendly (auditoría
 * 2026-10-01 I7). Las acciones que se llaman desde el cliente deben DEVOLVER
 * el error como dato.
 * Los redirect/notFound de Next se RELANZAN (ver toActionError).
 *
 *   export async function crearXSafeAction(input: unknown) {
 *     return runSafe(() => crearXAction(input), "crearX");
 *   }
 *
 * Devuelve `{ ok: true, data }` con lo que devuelva `fn`.
 */
export async function runSafe<T>(
  fn: () => Promise<T>,
  context?: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: toActionError(e, context) };
  }
}

/**
 * Convierte la excepción en mensaje para el usuario.
 *
 * OJO: si la excepción es un redirect/notFound de Next, **la relanza** en vez
 * de devolver nada. Es lo correcto: el caller no debe convertir una
 * navegación en un toast de error.
 */
export function toActionError(e: unknown, context?: string): string {
  if (isNextControlFlowError(e)) throw e;

  const where = context ? `[${context}] ` : "";
  console.error(`${where}acción falló:`, e);

  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  // Errores de Supabase/PostgREST: objeto plano con message (y a veces hint).
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; hint?: unknown; details?: unknown };
    for (const v of [o.message, o.details, o.hint]) {
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return "Ha fallado por un error inesperado. Vuelve a intentarlo; si sigue igual, repórtalo.";
}
