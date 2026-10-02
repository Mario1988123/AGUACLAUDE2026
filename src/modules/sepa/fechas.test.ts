import { describe, it, expect } from "vitest";
import { domingoDePascua, esDiaHabilTarget2, fechaCobroSepa } from "./fechas";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("I23 · fecha de cobro SEPA (TARGET2, D+2 hábiles)", () => {
  it("Pascua conocida", () => {
    expect(domingoDePascua(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(domingoDePascua(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
  });

  it("festivos TARGET2 y fines de semana", () => {
    expect(esDiaHabilTarget2(d("2026-10-03"))).toBe(false); // sábado
    expect(esDiaHabilTarget2(d("2026-12-25"))).toBe(false);
    expect(esDiaHabilTarget2(d("2026-12-26"))).toBe(false);
    expect(esDiaHabilTarget2(d("2027-03-26"))).toBe(false); // Viernes Santo
    expect(esDiaHabilTarget2(d("2027-03-29"))).toBe(false); // Lunes de Pascua
    expect(esDiaHabilTarget2(d("2027-05-03"))).toBe(true);
  });

  it("nunca es hoy ni una fecha pasada (antes: hoy en UTC)", () => {
    expect(fechaCobroSepa("2026-10-02")).toBe("2026-10-06"); // viernes → martes
    expect(fechaCobroSepa("2026-10-05")).toBe("2026-10-07");
  });

  it("salta Navidad y Semana Santa", () => {
    expect(fechaCobroSepa("2026-12-24")).toBe("2026-12-29");
    expect(fechaCobroSepa("2027-03-25")).toBe("2027-03-31");
    expect(fechaCobroSepa("2026-12-31")).toBe("2027-01-05");
  });

  it("plazo configurable y entrada inválida", () => {
    expect(fechaCobroSepa("2026-10-02", 1)).toBe("2026-10-05");
    expect(() => fechaCobroSepa("02/10/2026")).toThrow();
    expect(() => fechaCobroSepa("2026-10-02", 0)).toThrow();
  });
});
