import { describe, it, expect } from "vitest";
import { formatEur, formatCents } from "./format-money";

// Forma esencial e independiente del ICU: quita separador de miles y espacios
// raros (NBSP, narrow NBSP), normaliza el signo menos, y deja dígitos + coma
// decimal + €. Así el test verifica la división /100 y el formato sin depender
// de si es-ES agrupa miles con "." o con espacio en esta versión de Node.
const money = (s: string) => s.replace(/−/g, "-").replace(/[^0-9,€-]/g, "");

describe("formatEur", () => {
  it("null / undefined => placeholder neutro", () => {
    expect(formatEur(null)).toBe("—");
    expect(formatEur(undefined)).toBe("—");
  });

  it("interpreta la entrada en CÉNTIMOS (divide /100)", () => {
    expect(money(formatEur(1234))).toBe("12,34€");
  });

  it("0 céntimos => 0,00 € (no es null)", () => {
    expect(money(formatEur(0))).toBe("0,00€");
  });

  it("miles: parte entera 1500 con 2 decimales", () => {
    expect(money(formatEur(150000))).toBe("1500,00€");
  });

  it("importe negativo mantiene el signo", () => {
    expect(money(formatEur(-500))).toBe("-5,00€");
  });

  it("formatCents es un alias de formatEur", () => {
    expect(formatCents).toBe(formatEur);
  });
});
