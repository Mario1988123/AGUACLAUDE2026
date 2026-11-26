import { describe, expect, it } from "vitest";
import {
  contraste,
  derivarPaleta,
  distanciaOklab,
  hexAOklch,
  normalizarHex,
  oklchAHex,
  proponerPaletas,
} from "./paleta";

describe("conversión OKLCH", () => {
  it("ida y vuelta sin pérdida visible", () => {
    for (const hex of ["#28bce2", "#2563eb", "#ebc924", "#000000", "#ffffff", "#7a1f5c"]) {
      expect(distanciaOklab(oklchAHex(hexAOklch(hex)), hex)).toBeLessThan(0.005);
    }
  });
  it("normaliza el hexadecimal", () => {
    expect(normalizarHex("28BCE2")).toBe("#28bce2");
    expect(normalizarHex("#zzzzzz")).toBeNull();
  });
});

describe("derivarPaleta: contrastes garantizados en 4.096 colores", () => {
  const pasos = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255];
  const h = (n: number) => n.toString(16).padStart(2, "0");
  let peorTexto = 99;
  let peorCampo = 99;
  for (const r of pasos)
    for (const g of pasos)
      for (const b of pasos) {
        const color = `#${h(r)}${h(g)}${h(b)}`;
        const p = derivarPaleta(color, color);
        peorTexto = Math.min(
          peorTexto,
          contraste(p.primarioTrazo, p.papel),
          contraste(p.acentoTexto, p.papel),
          contraste(p.tintaSuave, p.papel),
        );
        peorCampo = Math.min(peorCampo, contraste(p.sobreCampo, p.primarioCampo));
        if (contraste(p.acentoMarca, p.papel) < 3) throw new Error(`acento marca ${color}`);
        if (contraste(p.tinta, p.velo) < 14) throw new Error(`tinta sobre velo ${color}`);
      }
  it("texto ≥ 4,5:1 sobre papel y sobre el campo", () => {
    expect(peorTexto).toBeGreaterThanOrEqual(4.5);
    expect(peorCampo).toBeGreaterThanOrEqual(4.5);
  });
});

describe("colores reales de producción (§C.2)", () => {
  it("Infinity #28bce2: campo con tinta encima, trazo oscurecido", () => {
    const p = derivarPaleta("#28bce2");
    expect(p.primarioCampo).toBe("#28bce2");
    expect(p.sobreCampo).not.toBe("#ffffff");
    expect(p.soloCampo).toBe(false);
    expect(distanciaOklab(p.primarioTrazo, "#0e819c")).toBeLessThan(0.03);
  });
  it("aquaroo #ebc924 (amarillo): solo campo, títulos en tinta", () => {
    const p = derivarPaleta("#ebc924");
    expect(p.soloCampo).toBe(true);
    expect(p.primarioTrazo).toBe(p.tinta);
  });
  it("tres propuestas; el contrapunto usa el segundo color del logo si es distinto", () => {
    const sin = proponerPaletas("#28bce2");
    expect(sin.map((x) => x.clave)).toEqual(["marca_sola", "contrapunto", "sobria"]);
    const conVerde = proponerPaletas("#28bce2", "#8fc31f");
    expect(conVerde[1]!.acento).toBe("#8fc31f");
    // Un segundo color casi del mismo tono no sirve de contrapunto.
    const parecido = proponerPaletas("#28bce2", "#2aa8e0");
    expect(parecido[1]!.acento).not.toBe("#2aa8e0");
    // Sobria: primario oscuro con blanco encima.
    const sobria = derivarPaleta(sin[2]!.primario, sin[2]!.acento);
    expect(sobria.sobreCampo).toBe("#ffffff");
  });
});
