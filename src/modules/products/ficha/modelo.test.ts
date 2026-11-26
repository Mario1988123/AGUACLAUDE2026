import { describe, expect, it } from "vitest";
import type { CaracteristicaEmpresa } from "../productos-vista";
import { textoValorAtributo, tieneValorAtributo } from "../valor-atributo";
import { coloresDominantes } from "./colores-logo";
import {
  bloquesDeFicha,
  cotasDeFicha,
  formatearTelefono,
  fusionarSeccionesProducto,
  leerSeccionesProducto,
  rasgosDe,
  seccionesEfectivas,
  referenciaImprimible,
  sinProveedor,
  textoImprimible,
} from "./modelo";

function c(p: Partial<CaracteristicaEmpresa> & { nombre: string; clave?: string }): CaracteristicaEmpresa {
  return {
    valorId: p.clave ?? p.nombre,
    atributoId: p.clave ?? p.nombre,
    clave: p.clave ?? p.nombre,
    nombre: p.nombre,
    grupo: p.grupo ?? "tecnicas",
    unidad: p.unidad ?? null,
    tipoDato: p.tipoDato ?? "number",
    valorTexto: p.valorTexto ?? null,
    valorNumero: p.valorNumero ?? null,
    valorBooleano: p.valorBooleano ?? null,
    orden: p.orden ?? 0,
    visible: p.visible ?? true,
    destacado: false,
    origen: null,
    heredado: true,
  };
}

const sinLimpiar = (t: string) => t;

describe("valor de una característica (fallo de data_type)", () => {
  it("lee la columna que tenga dato aunque el tipo diga otra cosa", () => {
    expect(textoValorAtributo({ value_text: "220-240V~50/60Hz", value_number: null, value_boolean: null })).toBe(
      "220-240V~50/60Hz",
    );
    expect(textoValorAtributo({ value_text: null, value_number: "0.27", value_boolean: null, unit: "L/min" })).toBe(
      "0,27 L/min",
    );
    expect(textoValorAtributo({ value_text: null, value_number: null, value_boolean: false })).toBe("No");
    expect(tieneValorAtributo({ value_text: " ", value_number: null, value_boolean: null })).toBe(false);
  });
});

describe("referencia de cabecera (respuesta 4)", () => {
  const base = { proveedor: "Osmofilter", nombresProveedor: [], prohibidos: ["Osmofilter", "Corsa"], refEnMaestro: false };
  it("sin referencia interna, ninguna", () => {
    expect(referenciaImprimible({ ...base, interna: null })).toBeNull();
  });
  it("la que coincide con un nombre del proveedor no se imprime", () => {
    expect(referenciaImprimible({ ...base, interna: "Blue sea -S", nombresProveedor: ["BLUE SEA 2.0"] })).toBeNull();
    expect(referenciaImprimible({ ...base, interna: "Fiord", refEnMaestro: true })).toBeNull();
    expect(referenciaImprimible({ ...base, interna: "FRO1046", proveedor: "FRO1046" })).toBeNull();
    expect(referenciaImprimible({ ...base, interna: "Osmofilter" })).toBeNull();
  });
  it("la propia sí", () => {
    expect(referenciaImprimible({ ...base, interna: "IA-DSP-01", nombresProveedor: ["DISPENSADOR BLUE MOUNTAIN"] })).toBe(
      "IA-DSP-01",
    );
  });
});

describe("textos sin el proveedor", () => {
  it("quita el modelo del proveedor salvo que esté en el nombre de la empresa", () => {
    expect(sinProveedor("Dispensador de Sobremesa Blue Mountain", ["Osmofilter", "BLUE MOUNTAIN"], "Infinity Basic S")).toBe(
      "Dispensador de Sobremesa",
    );
    expect(sinProveedor("Dispensador de gran capacidad Indic", ["INDIC"], "Infinity Indic")).toBe(
      "Dispensador de gran capacidad Indic",
    );
  });
  it("caracteres que Helvetica no tiene", () => {
    expect(textoImprimible("Capacidad de enfriamiento (Δ5 ºC)")).toBe("Capacidad de enfriamiento (salto 5 ºC)");
  });
});

describe("bloques de la ficha", () => {
  const caract = [
    c({ nombre: "Alimentación eléctrica", grupo: "electricas", tipoDato: "text", valorTexto: "220-240V~50/60Hz" }),
    c({ nombre: "Temperatura agua caliente mínima", unidad: "ºC", valorNumero: 70, orden: 1 }),
    c({ nombre: "Temperatura agua caliente máxima", unidad: "ºC", valorNumero: 75, orden: 2 }),
    c({ nombre: "Altura de dispensación (d)", grupo: "fisicas", unidad: "mm", valorNumero: 230 }),
    c({ nombre: "Agua fría", tipoDato: "boolean", valorBooleano: true, orden: 3 }),
    c({ nombre: "Voltaje", unidad: "V", valorNumero: 230, visible: false }),
    c({ nombre: "Válvula", tipoDato: "text", valorTexto: "Osmofilter TM69", orden: 4 }),
  ];
  const medidas = { anchoMm: 300, altoMm: 560, fondoMm: 400, pesoG: 15800 };

  it("cuatro grupos en orden, físicas con cotas y peso en kilos", () => {
    const b = bloquesDeFicha(caract, medidas, { conLetras: true, fabricantes: ["Osmofilter"], limpiar: sinLimpiar });
    expect(b.map((x) => x.clave)).toEqual(["fisicas", "electricas", "tecnicas"]);
    const fis = b[0]!.filas;
    expect(fis.map((f) => [f.cota, f.etiqueta, f.valor, f.unidad])).toEqual([
      ["a", "Ancho", "300", "mm"],
      ["b", "Alto", "560", "mm"],
      ["c", "Fondo", "400", "mm"],
      [null, "Peso", "15,8", "kg"],
      ["d", "Altura de dispensación", "230", "mm"],
    ]);
  });
  it("une mínimo y máximo, Sí/No como texto, ocultas fuera y nada que nombre al fabricante", () => {
    const b = bloquesDeFicha(caract, medidas, { conLetras: false, fabricantes: ["Osmofilter"], limpiar: sinLimpiar });
    const tec = b.find((x) => x.clave === "tecnicas")!.filas;
    expect(tec).toEqual([
      { cota: null, etiqueta: "Temperatura agua caliente", valor: "70–75", unidad: "ºC" },
      { cota: null, etiqueta: "Agua fría", valor: "Sí", unidad: "" },
    ]);
    expect(b[0]!.filas.every((f) => f.cota === null)).toBe(true);
  });
  it("sin datos, sin bloques («Sin Dato, Sin Hueco»)", () => {
    expect(
      bloquesDeFicha([], { anchoMm: null, altoMm: null, fondoMm: null, pesoG: null }, { conLetras: true, fabricantes: [], limpiar: sinLimpiar }),
    ).toEqual([]);
  });
  it("cotas para el dibujo", () => {
    expect(cotasDeFicha(medidas, caract)).toEqual({ a: 300, b: 560, c: 400, d: 230 });
  });
});

describe("utilidades", () => {
  it("teléfono español con espacios", () => {
    expect(formatearTelefono("620952598")).toBe("620 95 25 98");
    expect(formatearTelefono("+34 971 123 456")).toBe("+34 971 12 34 56");
    expect(formatearTelefono("00 44 20 1234")).toBe("00 44 20 1234");
  });
  it("rasgos", () => {
    expect(rasgosDe("Sobremesa · Ósmosis inversa · c/Bomba")).toEqual(["Sobremesa", "Ósmosis inversa", "c/Bomba"]);
  });
  it("colores del logo: descarta blancos y grises y ordena por peso", () => {
    const px: number[] = [];
    const pon = (r: number, g: number, b: number, n: number) => {
      for (let i = 0; i < n; i++) px.push(r, g, b, 255);
    };
    pon(255, 255, 255, 500); // fondo blanco
    pon(0, 159, 227, 300); // azul
    pon(151, 215, 0, 120); // verde
    pon(128, 128, 128, 200); // gris
    const out = coloresDominantes(new Uint8Array(px));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^#0[0-9a-f]9/);
  });
});

describe("características: visibles y orden", () => {
  it("salen solo las visibles y en su display_order", () => {
    const bloques = bloquesDeFicha(
      [
        c({ nombre: "Caudal", unidad: "l/h", valorNumero: 30, orden: 3 }),
        c({ nombre: "Presión", unidad: "bar", valorNumero: 2, orden: 1 }),
        c({ nombre: "Oculta", unidad: "bar", valorNumero: 9, orden: 2, visible: false }),
      ],
      { anchoMm: null, altoMm: null, fondoMm: null, pesoG: null },
      { conLetras: false, fabricantes: [], limpiar: (t) => t },
    );
    const etiquetas = bloques.flatMap((b) => b.filas.map((f) => f.etiqueta));
    expect(etiquetas).toEqual(["Presión", "Caudal"]);
  });
});

describe("secciones por producto", () => {
  const empresa = { mostrarVentajas: true, mostrarRecambios: false };
  it("sin anulación manda la empresa; el dibujo, sí", () => {
    expect(seccionesEfectivas(empresa, leerSeccionesProducto(null))).toEqual({
      ventajas: true,
      recambios: false,
      medidas: true,
    });
  });
  it("el producto manda sobre la empresa", () => {
    const p = leerSeccionesProducto({ ficha_secciones: { ventajas: false, recambios: true, medidas: false } });
    expect(seccionesEfectivas(empresa, p)).toEqual({ ventajas: false, recambios: true, medidas: false });
  });
  it("ignora valores que no son booleanos", () => {
    expect(leerSeccionesProducto({ ficha_secciones: { ventajas: "no", medidas: 0 } })).toEqual({
      ventajas: null,
      recambios: null,
      medidas: null,
    });
  });
  it("fusionar conserva lo de la IAGUA y null quita la anulación", () => {
    const extra = { features: [{ title: "A" }], ficha_secciones: { ventajas: false } };
    const a = fusionarSeccionesProducto(extra, { medidas: false });
    expect(a).toEqual({ features: [{ title: "A" }], ficha_secciones: { ventajas: false, medidas: false } });
    const b = fusionarSeccionesProducto(a, { ventajas: null, medidas: null });
    expect(b).toEqual({ features: [{ title: "A" }] });
    expect(extra.ficha_secciones).toEqual({ ventajas: false });
  });
});
