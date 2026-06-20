"use client";

import { toast } from "sonner";
import { logClientErrorAction } from "@/modules/error-reports/actions";

/**
 * Wrapper unificado del sistema de toast. Cuatro variantes alineadas a los
 * colores corporativos: success/error/warning/info.
 *
 * Además, CADA error que se muestre se registra automáticamente (en silencio)
 * en error_reports para que el superadmin identifique qué falla y con qué
 * frecuencia. Ver captureError() más abajo.
 */
export const notify = {
  success: (msg: string, description?: string) => toast.success(msg, { description }),
  error: (msg: string, description?: string) => {
    const clean = cleanDescription(description);
    captureError(msg, clean); // fire-and-forget, nunca rompe la UI
    return toast.error(msg, { description: clean });
  },
  warning: (msg: string, description?: string) => toast.warning(msg, { description }),
  info: (msg: string, description?: string) => toast.info(msg, { description }),
};

// ---------------------------------------------------------------------------
// Captura automática de errores → superadmin
// ---------------------------------------------------------------------------
// Anti-spam en el cliente: no reenviamos el mismo error más de una vez cada
// 30 s, y como mucho 50 envíos por carga de página. El agrupado "de verdad"
// (contador de ocurrencias) lo hace el servidor por huella.
const recentlySent = new Map<string, number>();
let sentCount = 0;
const THROTTLE_MS = 30_000;
const MAX_PER_PAGE = 50;

function captureError(msg: string, description?: string): void {
  try {
    if (typeof window === "undefined") return;
    if (sentCount >= MAX_PER_PAGE) return;
    const text = [msg, description].filter(Boolean).join(" — ").slice(0, 2000);
    if (text.length < 3) return;
    const now = Date.now();
    const last = recentlySent.get(text) ?? 0;
    if (now - last < THROTTLE_MS) return;
    recentlySent.set(text, now);
    sentCount += 1;
    const payload = {
      message: text,
      route: window.location?.pathname ?? null,
      technical_payload: {
        url: window.location?.href ?? null,
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
        viewport:
          typeof window.innerWidth === "number"
            ? `${window.innerWidth}x${window.innerHeight}`
            : null,
        captured_at: new Date().toISOString(),
      },
    };
    // No esperamos la respuesta ni propagamos errores: registrar un fallo
    // jamás debe provocar otro toast ni frenar al usuario.
    void Promise.resolve(logClientErrorAction(payload)).catch(() => {});
  } catch {
    /* nunca propagar */
  }
}

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
