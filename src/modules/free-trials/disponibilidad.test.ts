import { describe, expect, it } from "vitest";
import { opcionesParaAgendar, resumenDisponibilidad } from "./disponibilidad";

describe("opciones para agendar desde la disponibilidad", () => {
  it("sin disponibilidad no hay opciones", () => {
    expect(opcionesParaAgendar(null, "2026-11-26")).toEqual([]);
  });

  it("días concretos: quita los pasados y ordena", () => {
    const r = opcionesParaAgendar(
      {
        modo: "fechas",
        franjas: [
          { fecha: "2026-12-02", desde: "16:00", hasta: "20:00" },
          { fecha: "2026-11-20", desde: "10:00", hasta: "12:00" },
          { fecha: "2026-11-30", desde: "10:00", hasta: "12:00" },
        ],
      },
      "2026-11-26",
    );
    expect(r.map((o) => o.valor)).toEqual(["2026-11-30T10:00", "2026-12-02T16:00"]);
  });

  it("días fijos: próximas apariciones (26-11-2026 es jueves)", () => {
    const r = opcionesParaAgendar(
      { modo: "semanal", franjas: [{ dias: [1, 3], desde: "16:00", hasta: "20:00" }] },
      "2026-11-26",
    );
    expect(r.map((o) => o.valor)).toEqual([
      "2026-11-30T16:00",
      "2026-12-02T16:00",
      "2026-12-07T16:00",
      "2026-12-09T16:00",
    ]);
    expect(r[0]!.etiqueta).toContain("16:00–20:00");
  });

  it("respeta el máximo", () => {
    const r = opcionesParaAgendar(
      { modo: "semanal", franjas: [{ dias: [1, 2, 3, 4, 5], desde: "09:00", hasta: "14:00" }] },
      "2026-11-26",
      3,
    );
    expect(r).toHaveLength(3);
  });

  it("el resumen sigue funcionando", () => {
    expect(
      resumenDisponibilidad({
        modo: "semanal",
        franjas: [{ dias: [3, 1], desde: "16:00", hasta: "20:00" }],
      }),
    ).toEqual(["Lunes y miércoles · 16:00–20:00"]);
  });
});
