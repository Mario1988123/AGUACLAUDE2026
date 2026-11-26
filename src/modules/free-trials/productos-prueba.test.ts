import { describe, expect, it } from "vitest";
import {
  ROL_PRUEBA_GRATUITA,
  conMarcaPrueba,
  esDePruebaGratuita,
  productosNoPermitidos,
  productosParaPrueba,
} from "./productos-prueba";

const productos = [
  { id: "a", name: "Esencial de pie" },
  { id: "b", name: "Esencial de sobremesa" },
  { id: "c", name: "Ósmosis Blue" },
];

describe("marca de prueba gratuita", () => {
  it("detecta la marca en los roles", () => {
    expect(esDePruebaGratuita(["sellable_standalone", ROL_PRUEBA_GRATUITA])).toBe(true);
    expect(esDePruebaGratuita(["sellable_standalone"])).toBe(false);
    expect(esDePruebaGratuita(null)).toBe(false);
  });

  it("pone y quita la marca sin tocar los demás roles ni duplicar", () => {
    expect(conMarcaPrueba(["sellable_standalone"], true)).toEqual([
      "sellable_standalone",
      ROL_PRUEBA_GRATUITA,
    ]);
    expect(conMarcaPrueba(["sellable_standalone", ROL_PRUEBA_GRATUITA], true)).toEqual([
      "sellable_standalone",
      ROL_PRUEBA_GRATUITA,
    ]);
    expect(conMarcaPrueba([ROL_PRUEBA_GRATUITA, "accessory_role"], false)).toEqual([
      "accessory_role",
    ]);
    expect(conMarcaPrueba(null, false)).toEqual([]);
  });
});

describe("selector de productos de la prueba", () => {
  it("solo ofrece los marcados", () => {
    const r = productosParaPrueba(productos, new Set(["a", "b"]));
    expect(r.hayMarcados).toBe(true);
    expect(r.productos.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("sin ninguno marcado ofrece todos y lo dice", () => {
    const r = productosParaPrueba(productos, new Set());
    expect(r.hayMarcados).toBe(false);
    expect(r.productos).toHaveLength(3);
  });

  it("el servidor rechaza los no marcados", () => {
    expect(productosNoPermitidos(["a", "c", "c"], new Set(["a", "b"]))).toEqual(["c"]);
    expect(productosNoPermitidos(["a", "b"], new Set(["a", "b"]))).toEqual([]);
    expect(productosNoPermitidos(["c"], new Set())).toEqual([]);
  });
});
