/**
 * Colores de marca sacados del logo (§C.2, punto 1). PURO: recibe los píxeles
 * RGBA ya reducidos (la reducción con sharp está en imagenes.ts).
 *
 * Descarta transparentes, casi blancos (L > 0,93), casi negros (L < 0,18) y
 * grises (C < 0,04); agrupa por tono en 12 sectores de 30° y devuelve hasta
 * tres colores (la media de cada sector), del que más pesa al que menos.
 */

import { hexAOklch, oklchAHex } from "./paleta";

const h2 = (n: number) => n.toString(16).padStart(2, "0");

export function coloresDominantes(rgba: Uint8Array, maximo = 3): string[] {
  const sectores = Array.from({ length: 12 }, () => ({ n: 0, w: 0, l: 0, c: 0, x: 0, y: 0 }));
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 0) < 128) continue;
    const o = hexAOklch(`#${h2(rgba[i]!)}${h2(rgba[i + 1]!)}${h2(rgba[i + 2]!)}`);
    if (o.l > 0.93 || o.l < 0.18 || o.c < 0.04) continue;
    const s = sectores[Math.floor(o.h / 30) % 12]!;
    // Media ponderada por croma²: los bordes suavizados (pálidos) pesan poco
    // y sale el color de verdad del logo, no uno lavado.
    const w = o.c * o.c;
    s.n++;
    s.w += w;
    s.l += o.l * w;
    s.c += o.c * w;
    s.x += Math.cos((o.h * Math.PI) / 180) * w;
    s.y += Math.sin((o.h * Math.PI) / 180) * w;
  }
  const total = sectores.reduce((a, s) => a + s.n, 0);
  if (total === 0) return [];
  return sectores
    .filter((s) => s.n >= Math.max(3, total * 0.04))
    .sort((a, b) => b.n - a.n)
    .slice(0, maximo)
    .map((s) => {
      let h = (Math.atan2(s.y, s.x) * 180) / Math.PI;
      if (h < 0) h += 360;
      return oklchAHex({ l: s.l / s.w, c: s.c / s.w, h });
    });
}
