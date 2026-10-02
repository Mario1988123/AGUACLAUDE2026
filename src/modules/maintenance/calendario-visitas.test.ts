import { describe, expect, it } from "vitest";
import { fechasTeoricasContrato, serieEquipo, yaExisteVisita } from "./calendario-visitas";

const DIA = 86400000;

describe("fechasTeoricasContrato (I35)", () => {
  it("31-ene mensual cae el 28-feb, no el 3-mar", () => {
    const r = fechasTeoricasContrato({
      base: new Date("2026-01-31T09:00:00Z"), // 10:00 Madrid
      periodicidadMeses: 1,
      totalVisitas: 3,
      desde: new Date("2026-01-01T00:00:00Z"),
      hasta: new Date("2026-12-31T00:00:00Z"),
    });
    expect(r.map((x) => x.fecha.toISOString())).toEqual([
      "2026-02-28T09:00:00.000Z",
      "2026-03-31T08:00:00.000Z", // 10:00 Madrid en horario de verano
      "2026-04-30T08:00:00.000Z",
    ]);
  });
  it("solo devuelve las que caen en la ventana", () => {
    const r = fechasTeoricasContrato({
      base: new Date("2025-06-15T08:00:00Z"),
      periodicidadMeses: 6,
      totalVisitas: 4,
      desde: new Date("2026-01-01T00:00:00Z"),
      hasta: new Date("2026-12-31T00:00:00Z"),
    });
    expect(r.map((x) => x.idx)).toEqual([2, 3]);
  });
});

describe("serieEquipo", () => {
  it("adelanta una primera fecha pasada y no arrastra el recorte del día 31", () => {
    const r = serieEquipo({
      primera: new Date("2025-08-31T08:00:00Z"),
      periodicidadMeses: 6,
      ahora: new Date("2026-01-10T00:00:00Z"),
      hasta: new Date("2027-01-10T00:00:00Z"),
    });
    // 31-ago-25 → 28-feb-26 → 31-ago-26 (no 28-ago-26)
    expect(r.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-02-28", "2026-08-31"]);
  });
});

describe("yaExisteVisita", () => {
  const t = new Date("2026-03-10T09:00:00Z");
  it("una visita movida del 10 al 20 cuenta por su fecha original", () => {
    expect(
      yaExisteVisita(
        t,
        [{ scheduled_at: "2026-03-20T09:00:00Z", original_scheduled_at: "2026-03-10T09:00:00Z" }],
        2 * DIA,
      ),
    ).toBe(true);
  });
  it("sin fecha original, compara con la actual", () => {
    expect(yaExisteVisita(t, [{ scheduled_at: "2026-03-11T09:00:00Z" }], 2 * DIA)).toBe(true);
    expect(yaExisteVisita(t, [{ scheduled_at: "2026-03-20T09:00:00Z" }], 2 * DIA)).toBe(false);
  });
});
