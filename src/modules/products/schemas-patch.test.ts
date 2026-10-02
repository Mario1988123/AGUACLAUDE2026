import { describe, it, expect } from "vitest";
import { validateProductPatch, cashPlanError, productCreateSchema } from "./schemas";

describe("validateProductPatch (auditoría 2026-10-01 I8)", () => {
  it("rechaza una medida a 0 con mensaje legible", () => {
    const [p, err] = validateProductPatch({ name: "X", dim_depth_mm: 0 });
    expect(p).toBeNull();
    expect(err).toMatch(/^Profundidad \(mm\): /);
  });
  it("rechaza decimales en lugar de dejar que Postgres falle", () => {
    const [, err] = validateProductPatch({ dim_width_mm: 12.5 });
    expect(err).toMatch(/entero/);
  });
  it("vacío = sin dato (null), no 0", () => {
    const [p, err] = validateProductPatch({ dim_width_mm: "", weight_grams: null });
    expect(err).toBeNull();
    expect(p).toEqual({ dim_width_mm: null, weight_grams: null });
  });
  it("no toca las claves ausentes ni las que no son numéricas", () => {
    const [p] = validateProductPatch({ name: "Equipo", dim_height_mm: 300 });
    expect(p).toEqual({ name: "Equipo", dim_height_mm: 300 });
    expect(p && "dim_width_mm" in p).toBe(false);
  });
  it("stock_min vacío se guarda como 0 (columna NOT NULL)", () => {
    const [p] = validateProductPatch({ stock_min: null });
    expect(p).toEqual({ stock_min: 0 });
  });
  it("garantía negativa rechazada", () => {
    const [, err] = validateProductPatch({ warranty_months_general: -1 });
    expect(err).toMatch(/Garantía general/);
  });
});

describe("cashPlanError (auditoría 2026-10-01 I40)", () => {
  it("sin precio no hay nada que validar", () => {
    expect(
      cashPlanError({ cash_total_cents: null, cash_min_authorized_cents: 500, cash_absolute_min_cents: 900 }),
    ).toBeNull();
  });
  it("mínimo autorizado mayor que el total", () => {
    expect(
      cashPlanError({ cash_total_cents: 1000, cash_min_authorized_cents: 1200, cash_absolute_min_cents: null }),
    ).toMatch(/mínimo autorizado/);
  });
  it("mínimo absoluto mayor que el autorizado (heredado del total)", () => {
    expect(
      cashPlanError({ cash_total_cents: 1000, cash_min_authorized_cents: null, cash_absolute_min_cents: 1500 }),
    ).toMatch(/mínimo absoluto/);
  });
  it("coherente", () => {
    expect(
      cashPlanError({ cash_total_cents: 1000, cash_min_authorized_cents: 900, cash_absolute_min_cents: 800 }),
    ).toBeNull();
  });
});

describe("productCreateSchema con FormData vacío", () => {
  it("medidas en blanco no son 0 y el mensaje de 0 es el amable", () => {
    const ok = productCreateSchema.safeParse({ name: "Equipo", dim_width_mm: "", weight_grams: "" });
    expect(ok.success && ok.data.dim_width_mm).toBeNull();
    const bad = productCreateSchema.safeParse({ name: "Equipo", dim_width_mm: "0" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe("El ancho debe ser mayor que 0");
  });
});
