/**
 * Paletas de la ficha técnica a partir del color de la marca (diseño
 * docs/DISENO_FICHAS_Y_PRODUCTOS.md §C). Módulo PURO: sin base de datos, se
 * usa en el servidor (PDF) y en el cliente (vista previa de configuración).
 *
 * Se trabaja en OKLCH (perceptual) y el contraste se mide con la fórmula de
 * WCAG 2. Ningún color de texto se elige a ojo («Del Contraste Calculado»).
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** Tintas de una ficha, todas en «#RRGGBB». */
export interface PaletaFicha {
  papel: string;
  /** Texto principal: oscuro teñido de la marca, nunca negro puro. */
  tinta: string;
  /** Texto secundario (etiquetas, pie). ≥ 4,5:1 sobre papel. */
  tintaSuave: string;
  /** Fondo muy pálido del panel de la foto. */
  velo: string;
  /** El primario como superficie (franja, celda). */
  primarioCampo: string;
  /** Texto sobre `primarioCampo`: blanco o tinta, el que más contraste dé. */
  sobreCampo: string;
  /** Títulos y filetes. Si el primario es claro, es la tinta. */
  primarioTrazo: string;
  /** El primario no sirve como texto: solo se usa como campo. */
  soloCampo: boolean;
  /** Acento como texto (≥ 4,5:1 sobre papel). */
  acentoTexto: string;
  /** Acento como gráfico (letras de cota, iconos; ≥ 3:1). */
  acentoMarca: string;
  /** Los colores de partida, ya validados. */
  primario: string;
  acento: string;
}

export type ClavePropuesta = "marca_sola" | "contrapunto" | "sobria";

export interface PropuestaPaleta {
  clave: ClavePropuesta;
  nombre: string;
  descripcion: string;
  primario: string;
  acento: string;
}

export const NOMBRE_PROPUESTA: Record<ClavePropuesta | "manual", string> = {
  marca_sola: "Marca sola",
  contrapunto: "Marca y contrapunto",
  sobria: "Sobria",
  manual: "A mano",
};

// =============================================================================
// Conversión de color
// =============================================================================

const RE_HEX = /^#?([0-9a-f]{6})$/i;

export function esHex(v: unknown): v is string {
  return typeof v === "string" && RE_HEX.test(v.trim());
}

/** «28bce2» o «#28BCE2» → «#28bce2». Null si no es válido. */
export function normalizarHex(v: unknown): string | null {
  if (!esHex(v)) return null;
  return `#${RE_HEX.exec(v.trim())![1]!.toLowerCase()}`;
}

function hexARgb(hex: string): [number, number, number] {
  const h = normalizarHex(hex) ?? "#000000";
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  ];
}

function rgbAHex(r: number, g: number, b: number): string {
  const c = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const aLineal = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const aGamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

export function hexAOklch(hex: string): Oklch {
  const [r0, g0, b0] = hexARgb(hex);
  const r = aLineal(r0);
  const g = aLineal(g0);
  const b = aLineal(b0);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

/** OKLCH → sRGB lineal sin recortar (puede salir de gama). */
function oklchARgbLineal({ l: L, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const enGama = (rgb: [number, number, number]) => rgb.every((x) => x >= -1e-4 && x <= 1 + 1e-4);

/** OKLCH → «#rrggbb». Si sale de gama, baja el croma (búsqueda binaria). */
export function oklchAHex(o: Oklch): string {
  const L = Math.min(1, Math.max(0, o.l));
  let c = Math.max(0, o.c);
  let rgb = oklchARgbLineal({ l: L, c, h: o.h });
  if (!enGama(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (enGama(oklchARgbLineal({ l: L, c: mid, h: o.h }))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = oklchARgbLineal({ l: L, c, h: o.h });
  }
  return rgbAHex(aGamma(rgb[0]), aGamma(rgb[1]), aGamma(rgb[2]));
}

// =============================================================================
// Contraste (WCAG 2)
// =============================================================================

export function luminancia(hex: string): number {
  const [r, g, b] = hexARgb(hex).map(aLineal) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Distancia en OKLab (para avisar de que dos colores se parecen). */
export function distanciaOklab(a: string, b: string): number {
  const x = hexAOklch(a);
  const y = hexAOklch(b);
  const ax = x.c * Math.cos((x.h * Math.PI) / 180);
  const bx = x.c * Math.sin((x.h * Math.PI) / 180);
  const ay = y.c * Math.cos((y.h * Math.PI) / 180);
  const by = y.c * Math.sin((y.h * Math.PI) / 180);
  return Math.sqrt((x.l - y.l) ** 2 + (ax - ay) ** 2 + (bx - by) ** 2);
}

const BLANCO = "#ffffff";

/**
 * Oscurece un color en pasos de 0,01 de L hasta llegar al contraste pedido
 * sobre `fondo` (blanco por defecto). Devuelve el color y cuántos pasos
 * hicieron falta. Exportada para la propuesta de captación, que mide contra
 * papeles teñidos (docs/DISENO_PROPUESTA_CAPTACION.md §4.1).
 */
export function oscurecerHasta(hex: string, minimo: number, fondo = BLANCO): { hex: string; pasos: number } {
  const o = hexAOklch(hex);
  let actual = normalizarHex(hex)!;
  let pasos = 0;
  let l = o.l;
  while (contraste(actual, fondo) < minimo && l > 0) {
    l = Math.max(0, l - 0.01);
    pasos++;
    actual = oklchAHex({ l, c: o.c, h: o.h });
  }
  return { hex: actual, pasos };
}

// =============================================================================
// Paleta
// =============================================================================

/** Tintas de la ficha a partir de primario y acento («#rrggbb»). */
export function derivarPaleta(primarioEnt: string, acentoEnt?: string | null): PaletaFicha {
  const primario = normalizarHex(primarioEnt) ?? "#1f3a5f";
  const acento = normalizarHex(acentoEnt) ?? primario;
  const p = hexAOklch(primario);

  // Tinta: L 0,24 con un poco del tono de la marca. Si no llega a 14:1 sobre
  // papel, se baja L (los tonos amarillos y verdes son más luminosos).
  let tinta = oklchAHex({ l: 0.24, c: Math.min(p.c, 0.04), h: p.h });
  const velo = oklchAHex({ l: 0.965, c: Math.min(p.c, 0.02), h: p.h });
  for (let l = 0.24; contraste(tinta, velo) < 14 && l > 0.05; l -= 0.01) {
    tinta = oklchAHex({ l, c: Math.min(p.c, 0.04), h: p.h });
  }
  const tintaSuave = oscurecerHasta(oklchAHex({ l: 0.48, c: Math.min(p.c, 0.04), h: p.h }), 4.5).hex;

  // Primario como campo: el texto encima (blanco o tinta) tiene que dar 4,5:1.
  const sobreDe = (campo: string) =>
    contraste(BLANCO, campo) >= contraste(tinta, campo) ? BLANCO : tinta;
  let primarioCampo = primario;
  if (contraste(sobreDe(primario), primario) < 4.5) {
    // Se mueve L en el sentido que antes llegue: oscuro con blanco o claro con tinta.
    let mejor: string | null = null;
    for (let d = 0.01; d <= 1 && !mejor; d += 0.01) {
      for (const l of [p.l - d, p.l + d]) {
        if (l < 0 || l > 1) continue;
        const cand = oklchAHex({ l, c: p.c, h: p.h });
        if (contraste(sobreDe(cand), cand) >= 4.5) {
          mejor = cand;
          break;
        }
      }
    }
    primarioCampo = mejor ?? primario;
  }
  const sobreCampo = sobreDe(primarioCampo);

  // Primario como trazo (títulos, filetes): oscurecido hasta 4,5:1. Si hacen
  // falta más de 25 pasos (amarillos, pasteles), títulos y filetes en tinta.
  const trazo = oscurecerHasta(primario, 4.5);
  const soloCampo = trazo.pasos > 25;
  const primarioTrazo = soloCampo ? tinta : trazo.hex;

  return {
    papel: BLANCO,
    tinta,
    tintaSuave,
    velo,
    primarioCampo,
    sobreCampo,
    primarioTrazo,
    soloCampo,
    acentoTexto: oscurecerHasta(acento, 4.5).hex,
    acentoMarca: oscurecerHasta(acento, 3).hex,
    primario,
    acento,
  };
}

/**
 * Las tres propuestas desde un color base (§C.2). `segundo` es otro color del
 * logo, si lo hay: se usa como contrapunto cuando su tono está a más de 40° y
 * tiene color de verdad (croma > 0,06).
 */
export function proponerPaletas(baseEnt: string, segundo?: string | null): PropuestaPaleta[] {
  const base = normalizarHex(baseEnt) ?? "#1f3a5f";
  const b = hexAOklch(base);

  const acentoSola = oklchAHex({ l: Math.max(0.3, b.l - 0.22), c: b.c, h: b.h });

  let contrapunto = oklchAHex({ l: 0.62, c: 0.13, h: (b.h + 180) % 360 });
  const seg = normalizarHex(segundo);
  if (seg) {
    const s = hexAOklch(seg);
    const dh = Math.abs(((s.h - b.h + 540) % 360) - 180);
    if (dh > 40 && s.c > 0.06) contrapunto = seg;
  }

  const sobria = oklchAHex({ l: 0.3, c: Math.min(b.c, 0.05), h: b.h });

  return [
    {
      clave: "marca_sola",
      nombre: NOMBRE_PROPUESTA.marca_sola,
      descripcion: "Tu color y un tono más oscuro del mismo. La más segura.",
      primario: base,
      acento: acentoSola,
    },
    {
      clave: "contrapunto",
      nombre: NOMBRE_PROPUESTA.contrapunto,
      descripcion: seg && contrapunto === seg ? "Tu color y el segundo de tu logo." : "Tu color y su complementario. La más viva.",
      primario: base,
      acento: contrapunto,
    },
    {
      clave: "sobria",
      nombre: NOMBRE_PROPUESTA.sobria,
      descripcion: "Pizarra teñida de tu marca; tu color, solo de acento.",
      primario: sobria,
      acento: base,
    },
  ];
}

/** Paleta guardada en company_settings.datasheet_palette (migración 20261129100000). */
export interface PaletaGuardada {
  propuesta: ClavePropuesta | "manual";
  base: string;
  primario: string;
  acento: string;
}

export function leerPaletaGuardada(v: unknown): PaletaGuardada | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const primario = normalizarHex(o.primario);
  const acento = normalizarHex(o.acento);
  if (!primario || !acento) return null;
  const propuesta =
    o.propuesta === "marca_sola" || o.propuesta === "contrapunto" || o.propuesta === "sobria"
      ? o.propuesta
      : "manual";
  return { propuesta, base: normalizarHex(o.base) ?? primario, primario, acento };
}
