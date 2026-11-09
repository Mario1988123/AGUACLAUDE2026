/**
 * Serializa filas a CSV (RFC 4180-ish). Escapa comillas dobles y envuelve
 * en comillas si el valor contiene `,`, `"`, `\n` o `\r`.
 *
 * Antepone BOM UTF-8 para que Excel ES-ES lo abra con tildes correctas.
 *
 * Protección contra inyección de fórmulas (CSV injection): un texto que
 * empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro lo ejecutaría
 * Excel como fórmula al abrirlo (p. ej. un nombre de cliente
 * `=HYPERLINK(...)`). A esos textos se les antepone una comilla simple, que
 * Excel muestra como texto literal. Los números (de tipo number, o texto que
 * es solo un número como "-12,50") no se tocan: siguen siendo números.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Un número puro ("-12,50", "+3.5") no puede ser fórmula: se deja tal cual
    // para que los importes negativos sigan sumando en Excel.
    if (
      typeof v === "string" &&
      /^[=+\-@\t\r]/.test(s) &&
      !/^[+-]?\d+([.,]\d+)?$/.test(s)
    ) {
      s = `'${s}`;
    }
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = headers.map(escape).join(",");
  const body = rows.map((r) => r.map(escape).join(",")).join("\n");
  return `﻿${head}\n${body}\n`;
}
