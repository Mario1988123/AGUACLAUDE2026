import { describe, it, expect } from "vitest";
import { computeCycleRange } from "./cycles-utils";

// Compara una Date por sus componentes LOCALES (así las construye el source con
// new Date(y, m, d)), de forma independiente a la zona horaria.
const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe("computeCycleRange", () => {
  it("close_day=0 => ciclo del mes natural", () => {
    const r = computeCycleRange(new Date(2026, 5, 10), 0); // 10 jun 2026
    expect(r.cycle_year).toBe(2026);
    expect(r.cycle_month).toBe(6);
    expect(ymd(r.start_at)).toEqual([2026, 6, 1]);
    expect(ymd(r.end_at)).toEqual([2026, 7, 1]);
  });

  it("close_day=25, fecha ANTES del cierre => ciclo del mes actual (25 mes ant → 25 mes act)", () => {
    const r = computeCycleRange(new Date(2026, 5, 10), 25); // 10 jun
    expect(r.cycle_year).toBe(2026);
    expect(r.cycle_month).toBe(6);
    expect(ymd(r.start_at)).toEqual([2026, 5, 25]); // 25 may
    expect(ymd(r.end_at)).toEqual([2026, 6, 25]); // 25 jun
  });

  it("close_day=25, fecha EN/DESPUÉS del cierre => ciclo del mes siguiente", () => {
    const r = computeCycleRange(new Date(2026, 5, 28), 25); // 28 jun
    expect(r.cycle_year).toBe(2026);
    expect(r.cycle_month).toBe(7);
    expect(ymd(r.start_at)).toEqual([2026, 6, 25]); // 25 jun
    expect(ymd(r.end_at)).toEqual([2026, 7, 25]); // 25 jul
  });

  it("el día exacto de cierre cuenta para el ciclo siguiente", () => {
    const r = computeCycleRange(new Date(2026, 5, 25), 25); // 25 jun
    expect(r.cycle_month).toBe(7);
  });

  it("cruce de año (dic → ene)", () => {
    const r = computeCycleRange(new Date(2026, 11, 28), 25); // 28 dic 2026
    expect(r.cycle_year).toBe(2027);
    expect(r.cycle_month).toBe(1);
    expect(ymd(r.start_at)).toEqual([2026, 12, 25]);
    expect(ymd(r.end_at)).toEqual([2027, 1, 25]);
  });

  it("close_day fuera de rango (>28) se trata como mes natural", () => {
    const r = computeCycleRange(new Date(2026, 5, 10), 31);
    expect(ymd(r.start_at)).toEqual([2026, 6, 1]);
    expect(ymd(r.end_at)).toEqual([2026, 7, 1]);
  });
});
