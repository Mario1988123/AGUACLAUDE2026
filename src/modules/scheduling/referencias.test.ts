import { describe, expect, it, vi } from "vitest";
import {
  formatearReferencia,
  numeroDeReferencia,
  siguienteNumero,
  siguienteReferencia,
} from "./referencias";

describe("numeración de referencias (I25)", () => {
  it("ordena por número, no por texto: tras 9999 viene 10000", () => {
    // Como texto, "P-2026-9999" > "P-2026-10000" y se repetía el 10000.
    expect(siguienteNumero(["P-2026-9999", "P-2026-10000", "P-2026-0002"])).toBe(10001);
  });
  it("sin códigos empieza en 1", () => {
    expect(siguienteNumero([])).toBe(1);
    expect(siguienteNumero([null, undefined])).toBe(1);
  });
  it("formatea con 4 cifras mínimo", () => {
    expect(formatearReferencia("I", 2026, 7)).toBe("I-2026-0007");
    expect(formatearReferencia("I", 2026, 12345)).toBe("I-2026-12345");
  });
  it("extrae el número final", () => {
    expect(numeroDeReferencia("AH-2026-0042")).toBe(42);
    expect(numeroDeReferencia("sin-numero")).toBeNull();
  });
  it("usa la RPC atómica cuando existe", async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: "I-2026-0029", error: null }) };
    await expect(siguienteReferencia(admin, "emp", "installations", "I")).resolves.toBe(
      "I-2026-0029",
    );
    expect(admin.rpc).toHaveBeenCalledWith("next_reference_code", {
      p_company_id: "emp",
      p_table: "installations",
      p_prefix: "I",
    });
  });
  it("si la RPC falla por otra causa, NO cae al cálculo sin bloqueo", async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } }),
      from: vi.fn(),
    };
    await expect(siguienteReferencia(admin, "emp", "installations", "I")).rejects.toThrow();
    expect(admin.from).not.toHaveBeenCalled();
  });
});
