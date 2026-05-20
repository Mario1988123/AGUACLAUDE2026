"use client";

import { toast } from "sonner";

/**
 * Wrapper unificado del sistema de toast. Cuatro variantes alineadas a los
 * colores corporativos: success/error/warning/info.
 */
export const notify = {
  success: (msg: string, description?: string) => toast.success(msg, { description }),
  error: (msg: string, description?: string) =>
    toast.error(msg, { description: cleanDescription(description) }),
  warning: (msg: string, description?: string) => toast.warning(msg, { description }),
  info: (msg: string, description?: string) => toast.info(msg, { description }),
};

/**
 * Limpia mensajes de error que llegan redactados por Next.js o con
 * stacktrace técnico al usuario final (decisión 2026-05-20).
 *
 * Casos típicos:
 *   · "An error occurred in the Server Components..."  → mensaje amigable
 *   · Texto que empieza con stack lines tipo "at xxx"   → stripeamos
 *   · Mensajes con `digest:` al final                  → quitamos digest
 */
function cleanDescription(description?: string): string | undefined {
  if (!description) return description;
  let s = description;
  // Stack de Next: si contiene "at async" o "at " y newlines, quita todo
  // después del primer "\n    at "
  const stackMatch = s.match(/\n {4}at /);
  if (stackMatch && stackMatch.index !== undefined) {
    s = s.slice(0, stackMatch.index).trim();
  }
  // Quitar "{ digest: '...' }" al final
  s = s.replace(/\s*\{\s*digest:\s*['"]\d+['"]\s*\}\s*$/i, "").trim();
  // Redactado típico de Next.js
  if (
    /An error occurred in the Server Components render/i.test(s) ||
    s === "An error occurred"
  ) {
    return "Algo ha fallado en el servidor. Recarga la página o vuelve a intentarlo en un momento.";
  }
  return s;
}

/**
 * Extrae mensaje amigable de cualquier error (Error, string, unknown).
 * Útil en catch blocks para pasarlo a notify.error:
 *   notify.error("Título", getErrorMessage(err));
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Error desconocido";
}
