/**
 * Helper para parsear input con Zod devolviendo mensaje LEGIBLE en vez
 * del ZodError opaco que en producción aparece como "Server Components
 * render" digest sin contexto.
 *
 * Uso:
 *   const parsed = parseOrFriendly(leadCreateSchema, raw, "Lead");
 *
 * Si falla, lanza Error con formato:
 *   "[Lead] phone_primary: Teléfono con formato inválido"
 *
 * El front-end ya pinta este mensaje en el toast porque captura
 * `err instanceof Error ? err.message : String(err)`.
 */

import type { z } from "zod";

/**
 * Generic preserva la inferencia de defaults/transforms del schema
 * (output type). Si usábamos `ZodSchema<T>` el TS perdía los defaults
 * y campos con `.default(1)` aparecían como `number | undefined`.
 */
export function parseOrFriendly<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  label?: string,
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues;
  const first = issues[0];
  const path = first?.path?.length ? first.path.join(".") : "input";
  const msg = first?.message ?? "Datos inválidos";
  console.error(
    `[parseOrFriendly]${label ? ` ${label}` : ""} Zod failed:`,
    JSON.stringify(issues),
  );
  throw new Error(label ? `${label} · ${path}: ${msg}` : `${path}: ${msg}`);
}

export function safeParseFriendly<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): [z.output<S>, null] | [null, string] {
  const result = schema.safeParse(input);
  if (result.success) return [result.data, null];
  const first = result.error.issues[0];
  const path = first?.path?.length ? first.path.join(".") : "input";
  const msg = first?.message ?? "Datos inválidos";
  return [null, `${path}: ${msg}`];
}
