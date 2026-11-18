// Disponibilidad del cliente para que le instalen la prueba gratuita.
//
// Dos formas, excluyentes:
//   - "semanal": días fijos de la semana, cada grupo con su franja
//     (p. ej. lunes y miércoles de 10:00 a 12:00 · jueves de 14:00 a 20:00).
//   - "fechas": días concretos del calendario, cada uno con su franja
//     (porque puede que un lunes le venga bien y el siguiente no).
//
// Se guarda tal cual en free_trials.disponibilidad (jsonb). Es informativa:
// sirve a quien programa la visita; no bloquea ninguna fecha.
//
// Archivo SIN "use server": lo usan tanto el cliente (editor) como el servidor
// (validación al guardar).

import { z } from "zod";

export const DIAS_SEMANA: Array<{ valor: number; corto: string; largo: string }> = [
  { valor: 1, corto: "L", largo: "lunes" },
  { valor: 2, corto: "M", largo: "martes" },
  { valor: 3, corto: "X", largo: "miércoles" },
  { valor: 4, corto: "J", largo: "jueves" },
  { valor: 5, corto: "V", largo: "viernes" },
  { valor: 6, corto: "S", largo: "sábado" },
  { valor: 7, corto: "D", largo: "domingo" },
];

const hora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida en la disponibilidad");

const MENSAJE_ORDEN =
  "En cada franja de disponibilidad, la hora de inicio tiene que ser anterior a la de fin";

const franjaSemanalSchema = z
  .object({
    dias: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Elige al menos un día en cada franja de disponibilidad")
      .max(7),
    desde: hora,
    hasta: hora,
  })
  .refine((f) => f.desde < f.hasta, { message: MENSAJE_ORDEN });

const franjaFechaSchema = z
  .object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida en la disponibilidad"),
    desde: hora,
    hasta: hora,
  })
  .refine((f) => f.desde < f.hasta, { message: MENSAJE_ORDEN });

export const disponibilidadSchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("semanal"),
    franjas: z.array(franjaSemanalSchema).min(1).max(14),
  }),
  z.object({
    modo: z.literal("fechas"),
    franjas: z.array(franjaFechaSchema).min(1).max(62),
  }),
]);

export type Disponibilidad = z.infer<typeof disponibilidadSchema>;
export type FranjaSemanal = { dias: number[]; desde: string; hasta: string };
export type FranjaFecha = { fecha: string; desde: string; hasta: string };

/** Lee lo que venga de la BD; si no tiene la forma esperada, null. */
export function leerDisponibilidad(raw: unknown): Disponibilidad | null {
  if (!raw) return null;
  const r = disponibilidadSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Primer error legible, o null si es válida (o si no hay disponibilidad). */
export function validarDisponibilidad(d: Disponibilidad | null): string | null {
  if (!d) return null;
  const r = disponibilidadSchema.safeParse(d);
  if (r.success) return null;
  return r.error.issues[0]?.message ?? "La disponibilidad no es válida";
}

function unirConY(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

export function capitalizar(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** "2026-11-24" → "lun 24 nov" (sin depender de la zona horaria del servidor). */
export function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12)).toLocaleDateString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function tramo(desde: string, hasta: string): string {
  return `${desde}–${hasta}`;
}

/** Una línea por franja (semanal) o por día (fechas), lista para enseñar. */
export function resumenDisponibilidad(d: Disponibilidad | null | undefined): string[] {
  if (!d) return [];
  if (d.modo === "semanal") {
    return d.franjas.map((f) => {
      const dias = [...f.dias]
        .sort((a, b) => a - b)
        .map((v) => DIAS_SEMANA.find((x) => x.valor === v)?.largo ?? "?");
      return `${capitalizar(unirConY(dias))} · ${tramo(f.desde, f.hasta)}`;
    });
  }
  const porFecha = new Map<string, string[]>();
  for (const f of [...d.franjas].sort((a, b) =>
    a.fecha === b.fecha ? a.desde.localeCompare(b.desde) : a.fecha.localeCompare(b.fecha),
  )) {
    const lista = porFecha.get(f.fecha) ?? [];
    lista.push(tramo(f.desde, f.hasta));
    porFecha.set(f.fecha, lista);
  }
  return Array.from(porFecha.entries()).map(
    ([fecha, tramos]) => `${capitalizar(fechaCorta(fecha))} · ${unirConY(tramos)}`,
  );
}

/**
 * ¿Cae este momento (hora de pared, formato "AAAA-MM-DDTHH:MM" de un
 * <input type="datetime-local">) dentro de la disponibilidad?
 * null si no hay disponibilidad o el valor no se puede leer.
 */
export function encajaEnDisponibilidad(
  d: Disponibilidad | null,
  local: string,
): boolean | null {
  if (!d || !local) return null;
  const [fecha, horaTexto] = local.split("T");
  if (!fecha || !horaTexto) return null;
  const hhmm = horaTexto.slice(0, 5);
  const dentro = (f: { desde: string; hasta: string }) => hhmm >= f.desde && hhmm < f.hasta;
  if (d.modo === "fechas") {
    return d.franjas.some((f) => f.fecha === fecha && dentro(f));
  }
  const [y, m, dd] = fecha.split("-").map(Number);
  // getUTCDay: 0=domingo … 6=sábado → 1=lunes … 7=domingo
  const dow = ((new Date(Date.UTC(y!, (m ?? 1) - 1, dd ?? 1)).getUTCDay() + 6) % 7) + 1;
  return d.franjas.some((f) => f.dias.includes(dow) && dentro(f));
}
