import { describe, it, expect } from "vitest";
import { computeSavings, recommendedDispensers, type CalcConfig, type CalcInputs } from "./calc";

// Config realista de referencia (los valores por defecto del wizard de ahorro).
const CONFIG: CalcConfig = {
  osmosis_annual_cost_cents: 12000, // 120 €/año
  liters_per_person_day_home: 2,
  liters_per_person_day_office: 0.5,
  co2_per_bottle_kg: 0.08,
  plastic_per_bottle_kg: 0.04,
  default_bottle_size_liters: 1.5,
  service_garrafa_size_liters: 20,
  service_cycles_per_year: 13,
  recommended_dispensers_threshold: 15,
};

const baseInputs: CalcInputs = {
  client_type: "home",
  num_people: 4,
  current_service: "none",
  plan_type: "renting",
  product_unit_price_cents: 3000,
  num_units: 1,
  extras: [],
};

describe("computeSavings — cliente de agua embotellada, renting", () => {
  const r = computeSavings(CONFIG, {
    ...baseInputs,
    current_service: "bottled",
    current_price_per_liter_cents: 50, // 0,50 €/L
    plan_type: "renting",
    product_unit_price_cents: 3000, // 30 €/mes
  });

  it("coste actual mensual = litros/mes × precio (8 L/día × 30 × 0,50 €)", () => {
    // 4 pers × 2 L = 8 L/día → 240 L/mes → 240 × 50 = 12000 céntimos
    expect(r.current_monthly_cost_cents).toBe(12000);
  });

  it("nuestro coste mensual = cuota × unidades", () => {
    expect(r.total_monthly_cost_cents).toBe(3000);
    expect(r.cash_total_cents).toBe(0);
  });

  it("amortiza el primer mes (nuestro plan mucho más barato)", () => {
    expect(r.payback_months).toBe(1);
    expect(r.payback_years).toBe(1);
  });

  it("ahorro a 5 años = (12000 - 3000) × 60", () => {
    expect(r.total_saved_5y_cents).toBe(540000);
  });

  it("ecológico: botellas 1,5 L equivalentes/año y ratios", () => {
    // 8 L/día × 365 = 2920 L → /1,5 = 1947 botellas
    expect(r.bottles_saved_year).toBe(1947);
    expect(r.co2_saved_year_kg).toBe(155.8);
    expect(r.plastic_saved_year_kg).toBe(77.9);
  });
});

describe("computeSavings — compra al contado con extras (osmosis actual)", () => {
  const r = computeSavings(CONFIG, {
    ...baseInputs,
    num_people: 2,
    current_service: "osmosis",
    plan_type: "cash",
    product_unit_price_cents: 60000, // 600 € producto
    extras: [{ cash_price_cents: 5000, install_cents: 3000 }],
  });

  it("coste actual = coste anual osmosis / 12", () => {
    expect(r.current_monthly_cost_cents).toBe(1000);
  });

  it("total contado = producto + extras + instalación", () => {
    expect(r.cash_total_cents).toBe(68000);
    expect(r.total_monthly_cost_cents).toBe(0);
  });

  it("amortización tardía y años redondeados al alza", () => {
    // 68000 / 1000 €/mes → supera en el mes 69
    expect(r.payback_months).toBe(69);
    expect(r.payback_years).toBe(6);
  });

  it("ahorro a 5 años puede ser negativo (contado alto)", () => {
    // m1: 1000 - 68000 = -67000 ; m2..60: +1000 × 59 = 59000 → -8000
    expect(r.total_saved_5y_cents).toBe(-8000);
  });
});

describe("computeSavings — sin coste actual (none)", () => {
  const r = computeSavings(CONFIG, { ...baseInputs, current_service: "none" });

  it("payback null cuando el cliente no gasta hoy", () => {
    expect(r.payback_months).toBeNull();
    expect(r.payback_years).toBeNull();
  });

  it("ahorro a 5 años negativo = -cuota × 60", () => {
    expect(r.total_saved_5y_cents).toBe(-180000);
  });
});

describe("recommendedDispensers", () => {
  it("hogar siempre 1", () => {
    expect(recommendedDispensers(CONFIG, { client_type: "home", num_people: 50 })).toBe(1);
  });
  it("oficina: 2 por encima del umbral, 1 si no", () => {
    expect(recommendedDispensers(CONFIG, { client_type: "office", num_people: 20 })).toBe(2);
    expect(recommendedDispensers(CONFIG, { client_type: "office", num_people: 10 })).toBe(1);
  });
});
