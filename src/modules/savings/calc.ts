/**
 * Cálculo puro de la calculadora de ahorro. Sin dependencias de BD —
 * recibe todos los inputs y devuelve los outputs. Testeable en aislado.
 *
 * Inspirado en la lógica del legacy WATER_CRM pero adaptado al schema actual.
 */

export type ClientType = "home" | "office";
export type CurrentService = "osmosis" | "tap" | "bottled" | "service" | "none";
export type PlanType = "cash" | "rental" | "renting";

export interface CalcConfig {
  osmosis_annual_cost_cents: number;
  liters_per_person_day_home: number;
  liters_per_person_day_office: number;
  co2_per_bottle_kg: number;
  plastic_per_bottle_kg: number;
  default_bottle_size_liters: number; // 1.5
  service_garrafa_size_liters: number; // 20
  service_cycles_per_year: number; // 13
  recommended_dispensers_threshold: number; // 15
  enabled_plans?: { cash: boolean; rental: boolean; renting: boolean };
  default_renting_duration_months?: number;
  default_rental_permanence_months?: number;
}

export interface CalcInputs {
  client_type: ClientType;
  num_people: number;
  liters_per_person_day_override?: number; // si null usa config
  current_service: CurrentService;
  // Si current_service='bottled': usar precio por litro (céntimos)
  current_price_per_liter_cents?: number | null;
  // Si current_service='service'
  service_garrafas_per_month?: number | null;
  service_price_garrafa_cents?: number | null; // precio del paquete elegido
  // Producto elegido
  plan_type: PlanType;
  duration_months?: number | null; // si renting
  product_unit_price_cents: number; // cuota mensual o total contado
  num_units: number;
  // Extras (opcional). Cada uno con su precio mensual (renting/alquiler) o
  // precio total + instalación (cash).
  extras: Array<{
    monthly_cents?: number;
    cash_price_cents?: number;
    install_cents?: number;
  }>;
  // Fianza (alquiler) — opcional
  deposit_cents?: number;
}

export interface CalcResult {
  current_monthly_cost_cents: number;
  total_monthly_cost_cents: number; // nuestro coste mensual
  cash_total_cents: number; // si plan=cash, total venta + extras + instalación
  deposit_cents: number;
  // Año de amortización (null si no se amortiza en 10 años)
  payback_months: number | null;
  payback_years: number | null;
  // Ahorro acumulado a 5 años (cents). Negativo si nuestro plan es más caro.
  total_saved_5y_cents: number;
  // Ecológico — botellas equivalentes 1.5L evitadas/año
  bottles_saved_year: number;
  co2_saved_year_kg: number;
  plastic_saved_year_kg: number;
}

/**
 * Calcula litros/día consumidos por el hogar/empresa.
 * Empresa: si > threshold personas → 0.5 L/persona/día (recomendamos 2 dispensadores).
 * Hogar: 2 L/persona/día por defecto (configurable).
 */
function dailyLiters(config: CalcConfig, inputs: CalcInputs): number {
  if (inputs.liters_per_person_day_override != null) {
    return inputs.num_people * inputs.liters_per_person_day_override;
  }
  const perPerson =
    inputs.client_type === "office"
      ? config.liters_per_person_day_office
      : config.liters_per_person_day_home;
  return inputs.num_people * perPerson;
}

/**
 * Coste mensual del cliente HOY (antes de cambiarse).
 */
function currentMonthlyCost(config: CalcConfig, inputs: CalcInputs): number {
  switch (inputs.current_service) {
    case "osmosis":
      return Math.round(config.osmosis_annual_cost_cents / 12);
    case "tap":
    case "none":
      return 0;
    case "bottled": {
      if (!inputs.current_price_per_liter_cents) return 0;
      const monthlyLiters = dailyLiters(config, inputs) * 30;
      return Math.round(monthlyLiters * inputs.current_price_per_liter_cents);
    }
    case "service": {
      if (!inputs.service_price_garrafa_cents) return 0;
      // 13 ciclos al año / 12 meses → multiplicador para mensualizar
      return Math.round(
        (inputs.service_price_garrafa_cents * config.service_cycles_per_year) / 12,
      );
    }
    default:
      return 0;
  }
}

/**
 * Ratio de CO2 + plástico ahorrado al año.
 * Para `service` usa la conversión: garrafas × cycles × tamaño_garrafa / 1.5 → botellas equivalentes.
 * Para los demás usa litros anuales / 1.5.
 */
function ecologicalSavings(
  config: CalcConfig,
  inputs: CalcInputs,
): { bottles: number; co2: number; plastic: number } {
  let bottlesPerYear = 0;
  if (inputs.current_service === "service" && inputs.service_garrafas_per_month) {
    const garrafasYear = inputs.service_garrafas_per_month * config.service_cycles_per_year;
    const litersFromGarrafas = garrafasYear * config.service_garrafa_size_liters;
    bottlesPerYear = Math.round(litersFromGarrafas / config.default_bottle_size_liters);
  } else {
    const yearLiters = dailyLiters(config, inputs) * 365;
    bottlesPerYear = Math.round(yearLiters / config.default_bottle_size_liters);
  }
  return {
    bottles: bottlesPerYear,
    co2: Math.round(bottlesPerYear * config.co2_per_bottle_kg * 10) / 10,
    plastic: Math.round(bottlesPerYear * config.plastic_per_bottle_kg * 10) / 10,
  };
}

/**
 * Calcula coste mensual nuestro + total al firmar (cash + instalación + fianza).
 */
function ourCosts(inputs: CalcInputs): {
  monthly: number;
  cashTotal: number;
  deposit: number;
} {
  const productPrice = inputs.product_unit_price_cents * inputs.num_units;
  const extrasMonthly = inputs.extras.reduce((s, e) => s + (e.monthly_cents ?? 0), 0);
  const extrasCashTotal = inputs.extras.reduce(
    (s, e) => s + (e.cash_price_cents ?? 0) + (e.install_cents ?? 0),
    0,
  );
  if (inputs.plan_type === "cash") {
    return {
      monthly: 0,
      cashTotal: productPrice + extrasCashTotal,
      deposit: 0,
    };
  }
  return {
    monthly: productPrice + extrasMonthly,
    cashTotal: 0,
    deposit: inputs.deposit_cents ?? 0,
  };
}

/**
 * Calcula año de amortización (mes en que el coste acumulado del cliente
 * actual supera al nuestro acumulado).
 */
function paybackMonths(
  currentMonthly: number,
  ourMonthly: number,
  cashTotal: number,
  deposit: number,
  planType: PlanType,
): number | null {
  if (currentMonthly === 0) return null;
  let withUs = deposit + (planType === "cash" ? cashTotal : 0);
  let without = 0;
  for (let m = 1; m <= 120; m++) {
    if (planType !== "cash") withUs += ourMonthly;
    without += currentMonthly;
    if (without > withUs) return m;
  }
  return null;
}

export function computeSavings(config: CalcConfig, inputs: CalcInputs): CalcResult {
  const currentMonthly = currentMonthlyCost(config, inputs);
  const our = ourCosts(inputs);
  const payback = paybackMonths(
    currentMonthly,
    our.monthly,
    our.cashTotal,
    our.deposit,
    inputs.plan_type,
  );

  // Ahorro a 5 años (60 meses)
  let saved5y = 0;
  for (let m = 1; m <= 60; m++) {
    if (inputs.plan_type === "cash") {
      saved5y += currentMonthly - (m === 1 ? our.cashTotal : 0);
    } else {
      saved5y += currentMonthly - our.monthly;
    }
  }
  if (inputs.plan_type !== "cash" && our.deposit > 0) saved5y -= our.deposit;

  const eco = ecologicalSavings(config, inputs);

  return {
    current_monthly_cost_cents: currentMonthly,
    total_monthly_cost_cents: our.monthly,
    cash_total_cents: our.cashTotal,
    deposit_cents: our.deposit,
    payback_months: payback,
    payback_years: payback != null ? Math.ceil(payback / 12) : null,
    total_saved_5y_cents: saved5y,
    bottles_saved_year: eco.bottles,
    co2_saved_year_kg: eco.co2,
    plastic_saved_year_kg: eco.plastic,
  };
}

/**
 * Recomienda número de dispensadores según personas + tipo (empresa).
 */
export function recommendedDispensers(
  config: CalcConfig,
  inputs: Pick<CalcInputs, "client_type" | "num_people">,
): number {
  if (inputs.client_type !== "office") return 1;
  return inputs.num_people > config.recommended_dispensers_threshold ? 2 : 1;
}
