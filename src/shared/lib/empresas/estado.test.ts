import { describe, it, expect } from "vitest";
import { ESTADOS_EN_SERVICIO, empresaEnServicio, motivoBloqueoEmpresa } from "./estado";

describe("empresaEnServicio", () => {
  it("prueba y activa están en servicio", () => {
    expect(empresaEnServicio("trial")).toBe(true);
    expect(empresaEnServicio("active")).toBe(true);
  });
  it("pausada, de baja, nula o desconocida no", () => {
    expect(empresaEnServicio("suspended")).toBe(false);
    expect(empresaEnServicio("cancelled")).toBe(false);
    expect(empresaEnServicio(null)).toBe(false);
    expect(empresaEnServicio(undefined)).toBe(false);
    expect(empresaEnServicio("otra")).toBe(false);
  });
  it("cuadra con el bloqueo de acceso", () => {
    for (const s of ["trial", "active", "suspended", "cancelled"]) {
      expect(empresaEnServicio(s)).toBe(motivoBloqueoEmpresa(s) === null);
    }
    expect([...ESTADOS_EN_SERVICIO].sort()).toEqual(["active", "trial"]);
  });
});
