import { describe, expect, it } from "vitest";
import { productCreateSchema } from "./schemas";

// Lo que manda create-form.tsx cuando el usuario deja en blanco lo opcional.
const base = {
  name: "Equipo de prueba",
  kind: "equipment",
  category_id: "",
  dim_width_mm: "",
  dim_height_mm: "",
  dim_depth_mm: "",
  weight_grams: "",
  stock_min: "0",
  cash_total_cents: "",
  cash_min_authorized_cents: "",
  cash_absolute_min_cents: "",
};

describe("productCreateSchema", () => {
  it("las medidas en blanco quedan en null, no en 0 (CHECK > 0 en la tabla)", () => {
    const p = productCreateSchema.parse(base);
    expect(p.dim_width_mm).toBeNull();
    expect(p.dim_height_mm).toBeNull();
    expect(p.dim_depth_mm).toBeNull();
    expect(p.weight_grams).toBeNull();
  });

  it("acepta medidas con valor", () => {
    const p = productCreateSchema.parse({ ...base, dim_depth_mm: "350", weight_grams: "1200" });
    expect(p.dim_depth_mm).toBe(350);
    expect(p.weight_grams).toBe(1200);
  });

  it("rechaza una medida a 0 con un mensaje claro en vez de llegar a la base", () => {
    const r = productCreateSchema.safeParse({ ...base, dim_depth_mm: "0" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("El fondo debe ser mayor que 0");
  });

  it("los mínimos de precio en blanco quedan en null para heredar el total", () => {
    const p = productCreateSchema.parse({ ...base, cash_total_cents: "150000" });
    expect(p.cash_total_cents).toBe(150000);
    expect(p.cash_min_authorized_cents).toBeNull();
    expect(p.cash_absolute_min_cents).toBeNull();
  });
});
