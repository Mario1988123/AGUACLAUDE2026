import { describe, expect, it } from "vitest";
import { yaOtorgado, yaOtorgadoAlguno } from "./idempotencia";

describe("idempotencia de puntos (I43)", () => {
  it("un asiento positivo vigente bloquea otro igual", () => {
    expect(yaOtorgado([{ points: 10, reason: "sale", awarded_at: "2026-09-01T10:00:00Z" }], "sale")).toBe(true);
  });
  it("tras una reversión se puede volver a otorgar", () => {
    const asientos = [
      { points: 10, reason: "sale", awarded_at: "2026-09-01T10:00:00Z" },
      { points: -10, reason: "contract_cancelled", awarded_at: "2026-09-05T10:00:00Z" },
    ];
    expect(yaOtorgado(asientos, "sale")).toBe(false);
  });
  it("si se volvió a otorgar después de la reversión, ya no se repite", () => {
    const asientos = [
      { points: 10, reason: "sale", awarded_at: "2026-09-01T10:00:00Z" },
      { points: -10, reason: "contract_cancelled", awarded_at: "2026-09-05T10:00:00Z" },
      { points: 10, reason: "sale", awarded_at: "2026-09-10T10:00:00Z" },
    ];
    expect(yaOtorgado(asientos, "sale")).toBe(true);
  });
  it("otro motivo no bloquea", () => {
    expect(
      yaOtorgadoAlguno(
        [{ points: 5, reason: "installation_done", awarded_at: "2026-09-01T10:00:00Z" }],
        ["sale", "sale_with_discount"],
      ),
    ).toBe(false);
  });
});
