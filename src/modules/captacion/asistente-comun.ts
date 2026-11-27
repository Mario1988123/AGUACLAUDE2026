/**
 * Piezas del asistente que también usa el navegador (panel y FAQ). Sin
 * imports: asistente-logica.ts arrastra propuesta-logica.ts (node:crypto).
 */

export const MODELO_POR_DEFECTO = "claude-sonnet-5-5";

export const MODELOS_IA: ReadonlyArray<{ id: string; nombre: string; nota: string }> = [
  { id: "claude-sonnet-5-5", nombre: "Claude Sonnet 5.5", nota: "Recomendado: buen criterio y coste medio." },
  { id: "claude-haiku-5-5", nombre: "Claude Haiku 5.5", nota: "El más barato. Para preguntas sencillas." },
  { id: "claude-opus-5-5", nombre: "Claude Opus 5.5", nota: "El más capaz y el más caro." },
];

export function modeloValido(v: string | null | undefined): string {
  return MODELOS_IA.some((m) => m.id === v) ? (v as string) : MODELO_POR_DEFECTO;
}

/** Importes en euros que aparecen en un texto, en céntimos. */
export function importesEnTexto(texto: string | null | undefined): number[] {
  const t = (texto ?? "").replace(/ /g, " ");
  const re = /€\s*(\d[\d.]*(?:,\d{1,2})?)|(\d[\d.]*(?:,\d{1,2})?)\s*(?:€|euros?\b|eur\b)/gi;
  const salida: number[] = [];
  for (const m of t.matchAll(re)) {
    const crudo = (m[1] ?? m[2] ?? "").replace(/\.$/, "");
    const cents = aCentimos(crudo);
    if (cents != null) salida.push(cents);
  }
  return salida;
}

function aCentimos(v: string): number | null {
  if (!v) return null;
  let entero: string;
  let dec = "0";
  if (v.includes(",")) {
    const [a, b] = v.split(",");
    entero = (a ?? "").replace(/\./g, "");
    dec = b ?? "0";
  } else if (/^\d{1,3}(\.\d{3})+$/.test(v)) {
    entero = v.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(v)) {
    const [a, b] = v.split(".");
    entero = a ?? "";
    dec = b ?? "0";
  } else {
    entero = v.replace(/\./g, "");
  }
  if (!/^\d+$/.test(entero) || !/^\d{1,2}$/.test(dec)) return null;
  return Number.parseInt(entero, 10) * 100 + Number.parseInt(dec.padEnd(2, "0"), 10);
}

/** Aviso para la FAQ: los precios salen de Productos, no de aquí (§6.5). */
export function contienePrecio(texto: string | null | undefined): boolean {
  return importesEnTexto(texto).length > 0;
}
