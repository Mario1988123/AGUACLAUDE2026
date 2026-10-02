import { describe, it, expect } from "vitest";
import { parseToCents } from "./money-input";

describe("I41 · MoneyInput: texto → céntimos", () => {
  it("punto decimal ya no multiplica por 100 (antes 49.90 → 4.990 €)", () => {
    expect(parseToCents("49.90")).toBe(4990);
    expect(parseToCents("49.9")).toBe(4990);
    expect(parseToCents("0.5")).toBe(50);
  });

  it("coma decimal (es-ES)", () => {
    expect(parseToCents("49,90")).toBe(4990);
    expect(parseToCents("8")).toBe(800);
    expect(parseToCents("8,")).toBe(800);
    expect(parseToCents(",5")).toBe(50);
    expect(parseToCents("1 234,56 €")).toBe(123456);
  });

  it("separador de miles", () => {
    expect(parseToCents("1.234")).toBe(123400);
    expect(parseToCents("1.234,56")).toBe(123456);
    expect(parseToCents("1,234.56")).toBe(123456);
    expect(parseToCents("1.234.567")).toBe(123456700);
  });

  it("sin coma flotante: 1,005 no es válido y 0,07 son 7 céntimos", () => {
    expect(parseToCents("0,07")).toBe(7);
    expect(parseToCents("1,005")).toBeNull();
    expect(parseToCents("0.500")).toBeNull();
  });

  it("vacío = 0; basura, negativos y separadores mal puestos = inválido", () => {
    expect(parseToCents("")).toBe(0);
    expect(parseToCents("abc")).toBeNull();
    expect(parseToCents("-5")).toBeNull();
    expect(parseToCents("1,2,3")).toBeNull();
    expect(parseToCents("12,34.5")).toBeNull();
    expect(parseToCents("1.23.4")).toBeNull();
  });
});
