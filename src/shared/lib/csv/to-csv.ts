/**
 * Serializa filas a CSV (RFC 4180-ish). Escapa comillas dobles y envuelve
 * en comillas si el valor contiene `,`, `"`, `\n` o `\r`.
 *
 * Antepone BOM UTF-8 para que Excel ES-ES lo abra con tildes correctas.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = headers.map(escape).join(",");
  const body = rows.map((r) => r.map(escape).join(",")).join("\n");
  return `﻿${head}\n${body}\n`;
}
