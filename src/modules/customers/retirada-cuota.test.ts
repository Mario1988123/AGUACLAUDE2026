import { describe, expect, it } from "vitest";
import {
  calcularReduccionCuota,
  equiposRentingPuro,
  mensajeBajaBloqueadaPorRenting,
  notaRentingFinalizado,
} from "./retirada-logica";
import {
  fianzaDecidible,
  fianzaExcedida,
  resumenFianza,
  validarMotivoRetencion,
} from "@/modules/contracts/fianza-logica";

const lineas = [
  { product_id: "osmosis", quantity: 1, unit_price_cents: 3000 },
  { product_id: "descal", quantity: 2, unit_price_cents: 1500 },
];
const equipos = [
  { id: "e1", product_id: "osmosis", is_active: true },
  { id: "e2", product_id: "descal", is_active: true },
  { id: "e3", product_id: "descal", is_active: true },
];

describe("calcularReduccionCuota", () => {
  it("baja la cuota en el precio de la línea del equipo retirado", () => {
    const r = calcularReduccionCuota({ cuota_actual: 6000, lineas, equipos, retirando: ["e2"] });
    expect(r).toEqual({ ok: true, nueva: 4500, reduccion: 1500 });
  });

  it("descuenta lo ya retirado antes al comprobar que cuadra", () => {
    const eqs = equipos.map((e) => (e.id === "e2" ? { ...e, is_active: false } : e));
    const r = calcularReduccionCuota({ cuota_actual: 4500, lineas, equipos: eqs, retirando: ["e1"] });
    expect(r).toEqual({ ok: true, nueva: 1500, reduccion: 3000 });
  });

  it("el equipo que se retira ahora puede figurar ya como inactivo", () => {
    const eqs = equipos.map((e) => (e.id === "e1" ? { ...e, is_active: false } : e));
    const r = calcularReduccionCuota({ cuota_actual: 6000, lineas, equipos: eqs, retirando: ["e1"] });
    expect(r).toEqual({ ok: true, nueva: 3000, reduccion: 3000 });
  });

  it("no toca nada si la cuota no cuadra con las líneas (editada a mano)", () => {
    const r = calcularReduccionCuota({ cuota_actual: 5000, lineas, equipos, retirando: ["e2"] });
    expect(r.ok).toBe(false);
  });

  it("no reparte a ojo si el producto tiene dos precios o no tiene línea", () => {
    const dosPrecios = [...lineas, { product_id: "descal", quantity: 1, unit_price_cents: 900 }];
    expect(
      calcularReduccionCuota({ cuota_actual: 6900, lineas: dosPrecios, equipos, retirando: ["e2"] }).ok,
    ).toBe(false);
    expect(
      calcularReduccionCuota({
        cuota_actual: 6000,
        lineas,
        equipos: [...equipos, { id: "e4", product_id: "otro", is_active: true }],
        retirando: ["e4"],
      }).ok,
    ).toBe(false);
  });
});

describe("equiposRentingPuro", () => {
  const eqs = [
    { id: "a", installation_id: "i1", acquisition_type: "renting" },
    { id: "b", installation_id: "i2", acquisition_type: "rental" },
    { id: "c", installation_id: null, acquisition_type: "renting" },
    { id: "d", installation_id: "i3", acquisition_type: "renting" },
  ];
  const instMap = new Map([
    ["i1", "k1"],
    ["i2", "k2"],
    ["i3", "k3"],
  ]);
  const contratos = [
    { id: "k1", plan_type: "renting", status: "active", source_equipment_id: null },
    { id: "k2", plan_type: "rental", status: "active", source_equipment_id: null },
    { id: "k3", plan_type: "renting", status: "completed", source_equipment_id: null },
  ];
  it("bloquea solo renting vivo de contrato real; el equipo antiguo sin contrato no", () => {
    // "c" no tiene contrato: es un equipo antiguo instalado, aunque diga renting.
    expect(equiposRentingPuro(eqs, instMap, contratos)).toEqual(["a"]);
  });
  it("contrato heredado por source_equipment_id", () => {
    expect(
      equiposRentingPuro(
        [{ id: "x", installation_id: null, acquisition_type: null }],
        new Map(),
        [{ id: "k9", plan_type: "renting", status: "signed", source_equipment_id: "x" }],
      ),
    ).toEqual(["x"]);
  });
});

describe("resumenFianza", () => {
  it("pendiente = cobrada − devuelta − retenida", () => {
    expect(
      resumenFianza([
        { concept: "Fianza", amount_cents: 10000, status: "validated" },
        { concept: "Fianza alquiler", amount_cents: 5000, status: "pending" },
        { concept: "Cuota mensual · 2026-10", amount_cents: 3000, status: "validated" },
      ]),
    ).toEqual({ cobrada: 10000, devuelta: 0, retenida: 0, pendiente: 10000 });
  });
  it("tras reintegrar no queda nada (no se reintegra dos veces)", () => {
    const r = resumenFianza([
      { concept: "Fianza", amount_cents: 10000, status: "validated" },
      { concept: "Devolución fianza", amount_cents: -10000, status: "validated" },
    ]);
    expect(r.pendiente).toBe(0);
    expect(r.devuelta).toBe(10000);
  });
  it("la retención también cuenta", () => {
    const r = resumenFianza([
      { concept: "Fianza", amount_cents: 10000, status: "validated" },
      { concept: "Retención fianza (penalización)", amount_cents: 4000, status: "validated" },
    ]);
    expect(r.pendiente).toBe(6000);
  });
});

describe("decisión de la fianza en contratos cerrados", () => {
  it("solo en finalizados o cancelados", () => {
    expect(fianzaDecidible("completed")).toBe(true);
    expect(fianzaDecidible("cancelled")).toBe(true);
    expect(fianzaDecidible("active")).toBe(false);
  });
  it("la retención exige motivo", () => {
    expect(validarMotivoRetencion("").ok).toBe(false);
    expect(validarMotivoRetencion("  abc ").ok).toBe(false);
    expect(validarMotivoRetencion("Devuelto roto")).toEqual({ ok: true, motivo: "Devuelto roto" });
  });
  it("detecta un segundo envío que sobra", () => {
    expect(fianzaExcedida({ cobrada: 100, devuelta: 100, retenida: 0 })).toBe(false);
    expect(fianzaExcedida({ cobrada: 100, devuelta: 100, retenida: 100 })).toBe(true);
  });
});

describe("renting y baja de cliente", () => {
  it("el mensaje dice qué contrato lo impide y qué hacer", () => {
    const m = mensajeBajaBloqueadaPorRenting(["C-2026-0007"]);
    expect(m).toContain("C-2026-0007");
    expect(m).toContain("Finalizar renting");
  });
  it("la nota del equipo dice mantenimiento no obligatorio", () => {
    expect(notaRentingFinalizado("C-1", "09/11/2026")).toContain("mantenimiento no obligatorio");
  });
});
