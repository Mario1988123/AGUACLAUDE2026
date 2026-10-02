import { describe, it, expect } from "vitest";
import { evaluatePriceFloors, proposalStatusError, type PricePlanRow } from "./price-floors";

const P = "11111111-1111-1111-1111-111111111111";
const cash = (min: number, abs: number): PricePlanRow => ({
  product_id: P,
  plan_type: "cash",
  min_authorized_cents: min,
  absolute_min_cents: abs,
  duration_months: null,
});

describe("evaluatePriceFloors (auditoría 2026-10-01 I27)", () => {
  it("entre absoluto y autorizado: pide aprobación, no bloquea", () => {
    const r = evaluatePriceFloors([{ product_id: P, unit_price_cents: 900 }], [cash(1000, 800)], {
      planType: "cash",
      durationMonths: null,
    });
    expect(r).toEqual({ requiresApproval: true, belowAbsolute: null });
  });
  it("por debajo del absoluto en contado: bloquea", () => {
    const r = evaluatePriceFloors([{ product_id: P, unit_price_cents: 700 }], [cash(1000, 800)], {
      planType: "cash",
      durationMonths: null,
    });
    expect(r.belowAbsolute).toEqual({ product_id: P, unit_price_cents: 700, min_cents: 800 });
  });
  it("absoluto igual al autorizado (valor por defecto del panel): solo aprobación", () => {
    const r = evaluatePriceFloors([{ product_id: P, unit_price_cents: 500 }], [cash(1000, 1000)], {
      planType: "cash",
      durationMonths: null,
    });
    expect(r).toEqual({ requiresApproval: true, belowAbsolute: null });
  });
  it("renting: el absoluto (anclado al total) no se compara con la cuota", () => {
    const plan: PricePlanRow = {
      product_id: P,
      plan_type: "renting",
      min_authorized_cents: 3000,
      absolute_min_cents: 2000,
      duration_months: 48,
    };
    const r = evaluatePriceFloors([{ product_id: P, unit_price_cents: 1500 }], [plan], {
      planType: "renting",
      durationMonths: 48,
    });
    expect(r.belowAbsolute).toBeNull();
    expect(r.requiresApproval).toBe(true);
  });
  it("elige el plan de la duración pedida", () => {
    const plans: PricePlanRow[] = [
      { product_id: P, plan_type: "renting", min_authorized_cents: 5000, duration_months: 36 },
      { product_id: P, plan_type: "renting", min_authorized_cents: 3000, duration_months: 60 },
    ];
    const r = evaluatePriceFloors([{ product_id: P, unit_price_cents: 4000 }], plans, {
      planType: "renting",
      durationMonths: 60,
    });
    expect(r.requiresApproval).toBe(false);
  });
});

describe("proposalStatusError", () => {
  it("no se acepta ni se envía una propuesta pendiente de aprobación", () => {
    expect(proposalStatusError("accept", "pending_approval")).toMatch(/aprobación/);
    expect(proposalStatusError("send", "pending_approval")).toMatch(/aprobación/);
  });
  it("estados terminales", () => {
    expect(proposalStatusError("accept", "accepted")).toMatch(/ya está aceptada/);
    expect(proposalStatusError("send", "rejected")).toMatch(/no se puede enviar/);
    expect(proposalStatusError("accept", "expired")).toMatch(/no se puede aceptar/);
  });
  it("estados válidos", () => {
    for (const s of ["draft", "active", "sent"]) {
      expect(proposalStatusError("send", s)).toBeNull();
      expect(proposalStatusError("accept", s)).toBeNull();
    }
  });
});
