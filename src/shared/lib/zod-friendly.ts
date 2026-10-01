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

import { z } from "zod";

/**
 * Booleano seguro para formularios. NUNCA uses z.coerce.boolean() con
 * campos que vienen de un <form>/FormData: z.coerce.boolean() hace
 * Boolean(valor), y Boolean("false") === true, así que la cadena "false"
 * (la que mandan los checkboxes/hidden cuando están desmarcados) se
 * convertía en TRUE. Eso provocaba, p.ej., que un lead/cliente de EMPRESA
 * se tratara como autónomo, o que un interruptor desmarcado se guardara
 * activado.
 *
 * zBoolean() interpreta "true"/"1"/"on"/"yes"/"sí" como true y el resto
 * (incluida "false") como false. Soporta encadenar .optional()/.default():
 *   is_autonomo: zBoolean().optional().default(false)
 *   all_day:     zBoolean().default(false)
 */
export function zBoolean() {
  return z.preprocess(
    (v) =>
      typeof v === "string"
        ? ["true", "1", "on", "yes", "sí", "si"].includes(v.trim().toLowerCase())
        : Boolean(v),
    z.boolean(),
  );
}

/**
 * Entero opcional que llega de un <form>/FormData. z.coerce.number() hace
 * Number(valor), y Number("") === 0, así que un campo numérico que el usuario
 * deja en blanco llegaba como 0 en vez de como "sin dato". Con un CHECK (x > 0)
 * en la tabla eso rompía el alta (pasó con las medidas del producto el
 * 2026-10-01), y con un `??` detrás se colaba un 0 donde tocaba el valor por
 * defecto.
 *
 * zOptionalInt() trata "", espacios, null y undefined como null. `min` es el
 * mínimo admitido cuando SÍ hay valor (por defecto 0).
 */
export function zOptionalInt(min = 0, message?: string) {
  return z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
    z.coerce.number().int().min(min, message).nullable(),
  );
}

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
