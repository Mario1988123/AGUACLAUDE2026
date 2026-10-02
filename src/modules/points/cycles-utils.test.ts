import { describe, it, expect } from "vitest";
import { computeCycleRange } from "./cycles-utils";
import { claveDiaMadrid } from "@/modules/scheduling/fechas-madrid";

// Los ciclos se calculan en hora de Madrid (auditoría 2026-10-01, I36): se
// comparan los límites por su día natural en Madrid, sea cual sea la zona
// horaria de la máquina que pasa los tests.
const dia = (d: Date) => claveDiaMadrid(d);
// Mediodía de Madrid de un día dado (10:00 UTC sirve en verano e invierno).
const md = (clave: string) => new Date(`${clave}T10:00:00Z`);

describe("computeCycleRange", () => {
  it("close_day=0 => ciclo del mes natural", () => {
    const r = computeCycleRange(md("2026-06-10"), 0);
    expect(r.cycle_year).toBe(2026);
    expect(r.cycle_month).toBe(6);
    expect(dia(r.start_at)).toBe("2026-06-01");
    expect(dia(r.end_at)).toBe("2026-07-01");
    // Los límites son las 00:00 de Madrid (22:00 UTC del día anterior en verano)
    expect(r.start_at.toISOString()).toBe("2026-05-31T22:00:00.000Z");
  });

  it("close_day=25, fecha ANTES del cierre => ciclo del mes actual (25 mes ant → 25 mes act)", () => {
    const r = computeCycleRange(md("2026-06-10"), 25);
    expect(r.cycle_year).toBe(2026);
    expect(r.cycle_month).toBe(6);
    expect(dia(r.start_at)).toBe("2026-05-25");
    expect(dia(r.end_at)).toBe("2026-06-25");
  });

  it("close_day=25, fecha EN/DESPUÉS del cierre => ciclo del mes siguiente", () => {
    const r = computeCycleRange(md("2026-06-28"), 25);
    expect(r.cycle_year).toBe(2026);
    expect(r.cycle_month).toBe(7);
    expect(dia(r.start_at)).toBe("2026-06-25");
    expect(dia(r.end_at)).toBe("2026-07-25");
  });

  it("el día exacto de cierre cuenta para el ciclo siguiente", () => {
    const r = computeCycleRange(md("2026-06-25"), 25);
    expect(r.cycle_month).toBe(7);
  });

  it("cruce de año (dic → ene)", () => {
    const r = computeCycleRange(md("2026-12-28"), 25);
    expect(r.cycle_year).toBe(2027);
    expect(r.cycle_month).toBe(1);
    expect(dia(r.start_at)).toBe("2026-12-25");
    expect(dia(r.end_at)).toBe("2027-01-25");
  });

  it("close_day fuera de rango (>28) se trata como mes natural", () => {
    const r = computeCycleRange(md("2026-06-10"), 31);
    expect(dia(r.start_at)).toBe("2026-06-01");
    expect(dia(r.end_at)).toBe("2026-07-01");
  });

  it("una venta el 1-oct a las 01:30 de Madrid es del ciclo de octubre", () => {
    const r = computeCycleRange(new Date("2026-09-30T23:30:00Z"), 0);
    expect(r.cycle_month).toBe(10);
  });

  it("con cierre el 25, las 00:30 del 25 en Madrid ya son del ciclo siguiente", () => {
    const r = computeCycleRange(new Date("2026-06-24T22:30:00Z"), 25);
    expect(r.cycle_month).toBe(7);
  });
});
