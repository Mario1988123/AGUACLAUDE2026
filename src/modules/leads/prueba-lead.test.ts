import { describe, expect, it } from "vitest";
import {
  diasRestantesPrueba,
  pruebaEstaActiva,
  textoPruebaActiva,
} from "./prueba-lead";

describe("prueba activa en el lead", () => {
  it("solo cuando está instalada", () => {
    expect(pruebaEstaActiva("installed")).toBe(true);
    expect(pruebaEstaActiva("draft")).toBe(false);
    expect(pruebaEstaActiva("scheduled")).toBe(false);
  });
});

describe("días que quedan de prueba", () => {
  const ahora = new Date("2026-11-26T10:00:00Z");
  it("instalada hoy con 10 días → quedan 10", () => {
    expect(diasRestantesPrueba("2026-11-26T08:00:00Z", 10, ahora)).toBe(10);
  });
  it("instalada hace 3 días → quedan 7", () => {
    expect(diasRestantesPrueba("2026-11-23T17:00:00Z", 10, ahora)).toBe(7);
  });
  it("usa el día de Madrid (23:30 UTC ya es el día siguiente)", () => {
    expect(diasRestantesPrueba("2026-11-22T23:30:00Z", 10, ahora)).toBe(7);
  });
  it("vencida → 0, nunca negativo", () => {
    expect(diasRestantesPrueba("2026-10-01T10:00:00Z", 10, ahora)).toBe(0);
  });
  it("sin fecha de instalación → null", () => {
    expect(diasRestantesPrueba(null, 10, ahora)).toBeNull();
  });
  it("textos", () => {
    expect(textoPruebaActiva(7)).toBe("Prueba activa · quedan 7 días");
    expect(textoPruebaActiva(1)).toBe("Prueba activa · queda 1 día");
    expect(textoPruebaActiva(0)).toBe("Prueba activa · plazo cumplido");
    expect(textoPruebaActiva(null)).toBe("Prueba activa");
  });
});
