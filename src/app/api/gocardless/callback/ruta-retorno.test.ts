import { describe, expect, it } from "vitest";
import { conParametro, rutaRetornoSegura, RUTA_RETORNO_POR_DEFECTO } from "./ruta-retorno";

describe("rutaRetornoSegura (I20)", () => {
  it("acepta rutas internas", () => {
    expect(rutaRetornoSegura("/clientes/123")).toBe("/clientes/123");
    expect(rutaRetornoSegura("/contratos?tab=sepa")).toBe("/contratos?tab=sepa");
  });
  it("rechaza destinos externos y trucos", () => {
    for (const v of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "evil.com",
      "/",
      "/\t/evil.com",
      "",
      null,
      undefined,
    ]) {
      expect(rutaRetornoSegura(v)).toBe(RUTA_RETORNO_POR_DEFECTO);
    }
  });
  it("el resultado nunca sale del origen", () => {
    const base = "https://crm.hidromanager.es/api/gocardless/callback";
    for (const v of ["//evil.com", "/\\evil.com", "/clientes", "/\t/evil.com"]) {
      expect(new URL(rutaRetornoSegura(v), base).origin).toBe("https://crm.hidromanager.es");
    }
  });
});

describe("conParametro", () => {
  it("añade ? o & según toque", () => {
    expect(conParametro("/clientes", "gocardless", "ok")).toBe("/clientes?gocardless=ok");
    expect(conParametro("/c?x=1", "gocardless_error", "a b")).toBe(
      "/c?x=1&gocardless_error=a%20b",
    );
  });
});
