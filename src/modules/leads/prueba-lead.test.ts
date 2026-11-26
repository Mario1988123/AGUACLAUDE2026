import { describe, expect, it } from "vitest";
import { pruebaEstaActiva } from "./prueba-lead";

describe("prueba activa en el lead", () => {
  it("solo cuando está instalada", () => {
    expect(pruebaEstaActiva("installed")).toBe(true);
    expect(pruebaEstaActiva("draft")).toBe(false);
    expect(pruebaEstaActiva("scheduled")).toBe(false);
  });
});
