import { describe, it, expect } from "vitest";
import {
  calcularLinea,
  desglosarIvaIncluido,
  dividirRedondeando,
  pendienteFactura,
  precioUnitarioAGuardar,
  splitMonthlyFee,
  totalesFactura,
  validarCobroFactura,
  validarLineasFactura,
  type LineaImporte,
} from "./importes";

const linea = (p: Partial<LineaImporte>): LineaImporte => ({
  description: "X",
  quantity: 1,
  unit_price_cents: 0,
  discount_percent: 0,
  tax_rate_percent: 21,
  ...p,
});

describe("dividirRedondeando (mitad lejos del cero, simétrico)", () => {
  it("redondea .5 hacia fuera en positivo y en negativo", () => {
    expect(dividirRedondeando(2625, 10)).toBe(263);
    expect(dividirRedondeando(-2625, 10)).toBe(-263);
    expect(dividirRedondeando(2624, 10)).toBe(262);
    expect(dividirRedondeando(-2624, 10)).toBe(-262);
    expect(dividirRedondeando(0, 7)).toBe(0);
    expect(Object.is(dividirRedondeando(-1, 10), 0)).toBe(true); // sin -0
  });
});

describe("C3 · cuota mensual: base + IVA = cuota EXACTA", () => {
  it("100,00 € a particular = 82,64 + 17,36 (antes salía 100,01 €)", () => {
    expect(splitMonthlyFee(10000, 21, { party_kind: "individual" })).toEqual({
      base_cents: 8264,
      tax_cents: 1736,
      total_cents: 10000,
    });
  });

  it("los ejemplos del informe cuadran: 29,99 · 35,00", () => {
    for (const total of [2999, 3500]) {
      const r = splitMonthlyFee(total, 21, { party_kind: "individual" });
      expect(r.base_cents + r.tax_cents).toBe(total);
      expect(r.total_cents).toBe(total);
    }
  });

  it("para TODOS los importes de 0,01 € a 200,00 € (el bucle viejo fallaba en 3.454)", () => {
    for (let total = 1; total <= 20000; total++) {
      const r = splitMonthlyFee(total, 21, { party_kind: "individual", is_autonomo: false });
      expect(r.base_cents + r.tax_cents).toBe(total);
      // El IVA no se aparta más de 1 céntimo del 21 % de la base.
      expect(Math.abs(r.tax_cents - Math.round(r.base_cents * 0.21))).toBeLessThanOrEqual(1);
    }
  });

  it("empresa o autónomo: la cuota es base y se suma el IVA", () => {
    expect(splitMonthlyFee(10000, 21, { party_kind: "company" })).toEqual({
      base_cents: 10000,
      tax_cents: 2100,
      total_cents: 12100,
    });
    expect(splitMonthlyFee(10000, 21, { party_kind: "individual", is_autonomo: true }).total_cents).toBe(12100);
  });

  it("la línea con iva_incluido produce la misma factura que el desglose", () => {
    const t = calcularLinea(linea({ unit_price_cents: 10000, iva_incluido: true }));
    expect(t).toEqual({ subtotal_cents: 8264, tax_cents: 1736, total_cents: 10000 });
    const l = linea({ unit_price_cents: 10000, iva_incluido: true });
    expect(precioUnitarioAGuardar(l, t)).toBe(8264);
  });

  it("desglose con IVA reducido y 0 %", () => {
    expect(desglosarIvaIncluido(1100, 10)).toEqual({ base_cents: 1000, tax_cents: 100, total_cents: 1100 });
    expect(desglosarIvaIncluido(1234, 0)).toEqual({ base_cents: 1234, tax_cents: 0, total_cents: 1234 });
  });
});

describe("C5 · facturar contrato: sin doble IVA", () => {
  it("ósmosis de 1.210 € IVA incluido a particular = 1.000 + 210 (antes 1.464,10)", () => {
    const t = calcularLinea(linea({ unit_price_cents: 121000, iva_incluido: true }));
    expect(t).toEqual({ subtotal_cents: 100000, tax_cents: 21000, total_cents: 121000 });
  });

  it("varias unidades con IVA incluido: el total de la línea es cantidad × precio", () => {
    const l = linea({ quantity: 3, unit_price_cents: 4999, iva_incluido: true });
    const t = calcularLinea(l);
    expect(t.total_cents).toBe(14997);
    expect(t.subtotal_cents + t.tax_cents).toBe(14997);
  });

  it("empresa: el precio es base y se suma el IVA", () => {
    const t = calcularLinea(linea({ unit_price_cents: 100000 }));
    expect(t).toEqual({ subtotal_cents: 100000, tax_cents: 21000, total_cents: 121000 });
  });
});

describe("líneas normales", () => {
  it("cantidad decimal: el bruto se redondea a céntimo (antes podía quedar 499,5)", () => {
    const t = calcularLinea(linea({ quantity: 1.5, unit_price_cents: 333 }));
    expect(Number.isInteger(t.subtotal_cents)).toBe(true);
    expect(t.subtotal_cents).toBe(500);
    expect(t.tax_cents).toBe(105);
  });

  it("descuento", () => {
    expect(calcularLinea(linea({ unit_price_cents: 10000, discount_percent: 10 }))).toEqual({
      subtotal_cents: 9000,
      tax_cents: 1890,
      total_cents: 10890,
    });
  });

  it("la cabecera es la suma exacta de las líneas", () => {
    const ls = [
      linea({ unit_price_cents: 1999, quantity: 3 }),
      linea({ unit_price_cents: 10000, iva_incluido: true }),
      linea({ unit_price_cents: 123, tax_rate_percent: 10 }),
    ];
    const tot = totalesFactura(ls);
    const suma = ls.map(calcularLinea).reduce((a, t) => a + t.total_cents, 0);
    expect(tot.total_cents).toBe(suma);
    expect(tot.subtotal_cents + tot.tax_cents).toBe(tot.total_cents);
  });
});

describe("C4 · rectificativa por diferencias", () => {
  it("una línea en negativo es exactamente la opuesta (Math.round(-262.5) daba -262)", () => {
    for (const [precio, iva] of [
      [1250, 21],
      [2625, 10],
      [333, 21],
      [10000, 21],
      [4999, 4],
    ] as const) {
      const pos = calcularLinea(linea({ unit_price_cents: precio, tax_rate_percent: iva }));
      const neg = calcularLinea(linea({ quantity: -1, unit_price_cents: precio, tax_rate_percent: iva }));
      expect(neg.subtotal_cents).toBe(-pos.subtotal_cents);
      expect(neg.tax_cents).toBe(-pos.tax_cents);
      expect(neg.total_cents).toBe(-pos.total_cents);
    }
  });

  it("con importes fijos copia la línea emitida al céntimo (cuota con IVA incluido)", () => {
    const original = calcularLinea(linea({ unit_price_cents: 10000, iva_incluido: true }));
    const rect = calcularLinea(
      linea({
        quantity: -1,
        unit_price_cents: 8264,
        importes_fijos: { subtotal_cents: -original.subtotal_cents, tax_cents: -original.tax_cents },
      }),
    );
    expect(rect.total_cents).toBe(-10000);
    expect(validarLineasFactura(
      [linea({ quantity: -1, unit_price_cents: 8264, importes_fijos: { subtotal_cents: -8264, tax_cents: -1736 } })],
      "credit_note",
    )).toBeNull();
  });

  it("el signo se valida según el tipo de factura", () => {
    expect(validarLineasFactura([linea({ quantity: 1, unit_price_cents: 100 })], "credit_note")).toMatch(/negativo/);
    expect(validarLineasFactura([linea({ quantity: -1, unit_price_cents: 100 })], "invoice")).toMatch(/mayor que 0/);
  });
});

describe("I39 · validación antes de numerar", () => {
  it("cantidad vacía (NaN) o 0", () => {
    expect(validarLineasFactura([linea({ quantity: Number.NaN, unit_price_cents: 100 })], "invoice")).toMatch(/cantidad/);
    expect(validarLineasFactura([linea({ quantity: 0, unit_price_cents: 100 })], "invoice")).toMatch(/cantidad/);
  });
  it("descuento fuera de 0..100", () => {
    expect(validarLineasFactura([linea({ unit_price_cents: 100, discount_percent: 150 })], "invoice")).toMatch(/descuento/);
    expect(validarLineasFactura([linea({ unit_price_cents: 100, discount_percent: -5 })], "invoice")).toMatch(/descuento/);
  });
  it("precio no entero o negativo, descripción vacía, sin líneas, IVA raro", () => {
    expect(validarLineasFactura([linea({ unit_price_cents: 10.5 })], "invoice")).toMatch(/precio/);
    expect(validarLineasFactura([linea({ unit_price_cents: -1 })], "invoice")).toMatch(/precio/);
    expect(validarLineasFactura([linea({ description: "  ", unit_price_cents: 1 })], "invoice")).toMatch(/descripción/);
    expect(validarLineasFactura([], "invoice")).toMatch(/al menos una línea/);
    expect(validarLineasFactura([linea({ unit_price_cents: 1, tax_rate_percent: 121 })], "invoice")).toMatch(/IVA/);
    expect(validarLineasFactura([linea({ quantity: 1.2345, unit_price_cents: 1 })], "invoice")).toMatch(/3 decimales/);
  });
  it("una línea correcta pasa", () => {
    expect(validarLineasFactura([linea({ quantity: 2, unit_price_cents: 4990, discount_percent: 5 })], "invoice")).toBeNull();
  });
});

describe("I22 · reglas del cobro de una factura", () => {
  const base = { kind: "invoice", status: "issued", total_cents: 5000, pagado_cents: 0, permitir_borrador: false };
  it("no deja cobrar más de lo pendiente", () => {
    expect(validarCobroFactura({ ...base, importe_cents: 20000 })).toMatch(/supera/);
    expect(validarCobroFactura({ ...base, pagado_cents: 3000, importe_cents: 2001 })).toMatch(/supera/);
    expect(validarCobroFactura({ ...base, pagado_cents: 3000, importe_cents: 2000 })).toBeNull();
  });
  it("no deja cobrar cancelada, pagada, borrador (manual) ni rectificativa", () => {
    expect(validarCobroFactura({ ...base, status: "cancelled", importe_cents: 100 })).toMatch(/cancelled/);
    expect(validarCobroFactura({ ...base, status: "paid", importe_cents: 100 })).toMatch(/cobrada/);
    expect(validarCobroFactura({ ...base, status: "draft", importe_cents: 100 })).toMatch(/Emite/);
    expect(validarCobroFactura({ ...base, kind: "credit_note", importe_cents: 100 })).toMatch(/ordinarias/);
  });
  it("los flujos automáticos sí cobran el borrador de la cuota", () => {
    expect(validarCobroFactura({ ...base, status: "draft", permitir_borrador: true, importe_cents: 5000 })).toBeNull();
  });
  it("importe 0, negativo o con decimales", () => {
    expect(validarCobroFactura({ ...base, importe_cents: 0 })).toMatch(/mayor que 0/);
    expect(validarCobroFactura({ ...base, importe_cents: -5 })).toMatch(/mayor que 0/);
    expect(validarCobroFactura({ ...base, importe_cents: 10.5 })).toMatch(/mayor que 0/);
  });
});

describe("pendiente de una factura", () => {
  it("rectificativa y cerradas: 0; resto: total − cobrado", () => {
    expect(pendienteFactura({ kind: "credit_note", status: "issued", total_cents: -10000, pagado_cents: 0 })).toBe(0);
    expect(pendienteFactura({ kind: "invoice", status: "cancelled", total_cents: 10000, pagado_cents: 0 })).toBe(0);
    expect(pendienteFactura({ kind: "invoice", status: "issued", total_cents: 10000, pagado_cents: 2500 })).toBe(7500);
  });
});
