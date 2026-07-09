import { describe, it, expect } from "vitest";
import { isPendingIban, checkIbanLive } from "./iban-partial";

describe("isPendingIban (placeholder ES00 = 'lo doy antes de firmar')", () => {
  it("reconoce ES00 pelado o con ceros/espacios, en cualquier grafía", () => {
    expect(isPendingIban("ES00")).toBe(true);
    expect(isPendingIban("ES0000")).toBe(true);
    expect(isPendingIban("es00")).toBe(true);
    expect(isPendingIban("ES00 0000")).toBe(true);
  });
  it("un IBAN real no es pending; vacío tampoco", () => {
    expect(isPendingIban("ES9121000418450200051332")).toBe(false);
    expect(isPendingIban("")).toBe(false);
  });
});

describe("checkIbanLive (validación en vivo del input)", () => {
  it("menos de 4 chars => incomplete", () => {
    expect(checkIbanLive("")).toEqual({ state: "incomplete" });
    expect(checkIbanLive("ES")).toEqual({ state: "incomplete" });
  });
  it("no empieza por 2 letras + 2 dígitos => invalid", () => {
    expect(checkIbanLive("1234")).toEqual({ state: "invalid" });
  });
  it("ES00 => pending", () => {
    expect(checkIbanLive("ES00")).toEqual({ state: "pending" });
  });
  it("ES incompleto (<24) => incomplete", () => {
    expect(checkIbanLive("ES91210004184502")).toEqual({ state: "incomplete" });
  });
  it("IBAN español completo y correcto => valid", () => {
    expect(checkIbanLive("ES9121000418450200051332")).toEqual({ state: "valid" });
  });
  it("IBAN completo con DC erróneo => invalid_dc + DC esperado", () => {
    expect(checkIbanLive("ES9921000418450200051332")).toEqual({
      state: "invalid_dc",
      expected: "91",
    });
  });
});
