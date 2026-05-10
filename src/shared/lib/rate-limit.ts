/**
 * Rate limiter en memoria por (userId + actionKey). Ventana móvil simple.
 * Para producción multi-instance habría que usar Redis o Supabase row-lock,
 * pero esto cubre el caso de evitar clicks rápidos del mismo usuario en
 * la misma instancia.
 *
 * Uso:
 *   import { checkRate } from "@/shared/lib/rate-limit";
 *   if (!checkRate(`payment:${session.user_id}`, 5, 60_000)) {
 *     throw new Error("Demasiadas peticiones, espera un momento");
 *   }
 */

const buckets = new Map<string, number[]>();

export function checkRate(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const arr = buckets.get(key) ?? [];
  const valid = arr.filter((ts) => now - ts < windowMs);
  if (valid.length >= maxRequests) {
    buckets.set(key, valid);
    return false;
  }
  valid.push(now);
  buckets.set(key, valid);
  // Limpieza ocasional
  if (Math.random() < 0.01) {
    for (const [k, v] of buckets) {
      const fresh = v.filter((ts) => now - ts < 5 * 60_000);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }
  return true;
}

/**
 * Helper para usar como guard en server actions. Throws si excede.
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  message = "Demasiadas peticiones. Espera un momento.",
): void {
  if (!checkRate(key, maxRequests, windowMs)) {
    throw new Error(message);
  }
}
