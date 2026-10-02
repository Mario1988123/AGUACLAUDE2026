import { describe, expect, it } from "vitest";
import { agruparCambios, enTramos, puntuacionChurn, type AgregadosChurn } from "./calculo";

const DIA = 86400000;
const ahora = Date.UTC(2026, 9, 2);

function ag(p: Partial<AgregadosChurn> = {}): AgregadosChurn {
  return {
    ultimoMantenimiento: new Map(),
    conCobroRechazado: new Set(),
    conIncidenciaAbierta: new Set(),
    conContratoCancelado: new Set(),
    ...p,
  };
}

describe("puntuacionChurn (C2)", () => {
  it("cliente sin señales = 0", () => {
    expect(puntuacionChurn("c1", ag(), ahora)).toBe(0);
  });
  it("mantenimiento hace más de un año +30; entre 181 y 365 días +15", () => {
    expect(
      puntuacionChurn("c1", ag({ ultimoMantenimiento: new Map([["c1", ahora - 400 * DIA]]) }), ahora),
    ).toBe(30);
    expect(
      puntuacionChurn("c1", ag({ ultimoMantenimiento: new Map([["c1", ahora - 200 * DIA]]) }), ahora),
    ).toBe(15);
    expect(
      puntuacionChurn("c1", ag({ ultimoMantenimiento: new Map([["c1", ahora - 30 * DIA]]) }), ahora),
    ).toBe(0);
  });
  it("suma todas las señales y acota a 100", () => {
    const a = ag({
      ultimoMantenimiento: new Map([["c1", ahora - 400 * DIA]]),
      conCobroRechazado: new Set(["c1"]),
      conIncidenciaAbierta: new Set(["c1"]),
      conContratoCancelado: new Set(["c1"]),
    });
    expect(puntuacionChurn("c1", a, ahora)).toBe(85);
  });
});

describe("agruparCambios", () => {
  it("solo incluye clientes cuya puntuación cambia, agrupados por valor", () => {
    const a = ag({ conCobroRechazado: new Set(["c2", "c3"]) });
    const g = agruparCambios(
      [
        { id: "c1", churn_score: 0 }, // sigue en 0 → no se toca
        { id: "c2", churn_score: null }, // pasa a 25
        { id: "c3", churn_score: 25 }, // sigue en 25 → no se toca
        { id: "c4", churn_score: 40 }, // baja a 0
      ],
      a,
      ahora,
    );
    expect(g.get(25)).toEqual(["c2"]);
    expect(g.get(0)).toEqual(["c4"]);
    expect(g.size).toBe(2);
  });
  it("enTramos trocea sin perder elementos", () => {
    expect(enTramos([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
