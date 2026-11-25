import { describe, expect, it } from "vitest";
import {
  calcularCargaSugerida,
  diaDeCarga,
  filtrosDeMantenimiento,
  lineasConfirmadas,
  resolverReserva,
  type CantidadArticulo,
} from "./carga-sugerida-logica";

const p = (id: string, cantidad: number): CantidadArticulo => ({ tipo: "producto", id, cantidad });
const f = (id: string, cantidad: number): CantidadArticulo => ({ tipo: "filtro", id, cantidad });
const sumar = (c: string, n: number) => {
  const d = new Date(`${c}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe("calcularCargaSugerida", () => {
  it("necesidad + reserva − lo que lleva", () => {
    const r = calcularCargaSugerida({
      necesidad: [p("equipo", 2), f("combi", 3)],
      reserva: [f("combi", 2)],
      lleva: [f("combi", 1)],
    });
    const combi = r.aCargar.find((l) => l.id === "combi")!;
    expect(combi.aCargar).toBe(4); // 3 + 2 − 1
    expect(combi.paraTrabajos).toBe(2); // lo que lleva cubre primero los trabajos
    expect(combi.paraReserva).toBe(2);
    const equipo = r.aCargar.find((l) => l.id === "equipo")!;
    expect(equipo.aCargar).toBe(2);
    expect(r.totalUnidades).toBe(6);
  });

  it("no carga nada si ya lleva bastante y marca lo que sobra", () => {
    const r = calcularCargaSugerida({
      necesidad: [f("combi", 1)],
      reserva: [f("combi", 1)],
      lleva: [f("combi", 5), p("suelto", 2)],
    });
    expect(r.aCargar).toHaveLength(0);
    expect(r.cubiertas.map((l) => l.id)).toEqual(["combi"]);
    expect(r.sobrantes.find((l) => l.id === "combi")!.sobra).toBe(3);
    expect(r.sobrantes.find((l) => l.id === "suelto")!.sobra).toBe(2);
    expect(r.totalUnidades).toBe(0);
  });

  it("repone solo la reserva cuando no hay trabajos", () => {
    const r = calcularCargaSugerida({ necesidad: [], reserva: [p("grifo", 2)], lleva: [p("grifo", 1)] });
    expect(r.aCargar).toEqual([
      expect.objectContaining({ id: "grifo", aCargar: 1, paraTrabajos: 0, paraReserva: 1 }),
    ]);
  });

  it("no confunde un producto y un filtro con el mismo id", () => {
    const r = calcularCargaSugerida({ necesidad: [p("x", 1), f("x", 1)], reserva: [], lleva: [p("x", 1)] });
    expect(r.aCargar).toHaveLength(1);
    expect(r.aCargar[0]).toMatchObject({ tipo: "filtro", id: "x", aCargar: 1 });
  });

  it("suma líneas repetidas e ignora cantidades negativas o no numéricas", () => {
    const r = calcularCargaSugerida({
      necesidad: [f("a", 1), f("a", 2), f("a", -4), f("a", Number.NaN)],
      reserva: [],
      lleva: [],
    });
    expect(r.aCargar[0]!.aCargar).toBe(3);
  });

  it("ordena primero lo que piden los trabajos", () => {
    const r = calcularCargaSugerida({ necesidad: [f("t", 1)], reserva: [f("r", 5)], lleva: [] });
    expect(r.aCargar.map((l) => l.id)).toEqual(["t", "r"]);
  });
});

describe("resolverReserva", () => {
  it("si la furgoneta tiene reserva propia, vale solo esa", () => {
    const m = resolverReserva([f("combi", 2), p("grifo", 1), f("post", 1)], [f("combi", 4), p("grifo", 0)]);
    expect(m.get("f:combi")!.cantidad).toBe(4);
    expect(m.has("p:grifo")).toBe(false);
    expect(m.has("f:post")).toBe(false);
  });

  it("sin reserva propia, la de la empresa es la plantilla", () => {
    const m = resolverReserva([f("combi", 2), p("grifo", 0)], []);
    expect(m.get("f:combi")!.cantidad).toBe(2);
    expect(m.has("p:grifo")).toBe(false);
  });
});

describe("filtrosDeMantenimiento", () => {
  const asign = [
    { product_id: "basic", filter_id: "combi", quantity_per_change: 1, is_required: true },
    { product_id: "basic", filter_id: "membrana", quantity_per_change: 1, is_required: true },
    { product_id: "basic", filter_id: "opcional", quantity_per_change: 1, is_required: false },
    { product_id: "basic", filter_id: "post", quantity_per_change: 2, is_required: true },
    { product_id: "beast", filter_id: "beast", quantity_per_change: 1, is_required: true },
  ];
  const esMembrana = (id: string) => id === "membrana";

  it("solo filtros obligatorios del modelo, sin membranas", () => {
    expect(filtrosDeMantenimiento("basic", asign, esMembrana)).toEqual([f("combi", 1), f("post", 2)]);
  });

  it("equipo sin modelo no pide nada (lo cubre la reserva)", () => {
    expect(filtrosDeMantenimiento(null, asign, esMembrana)).toEqual([]);
  });

  it("cantidad por cambio vacía cuenta 1", () => {
    expect(
      filtrosDeMantenimiento(
        "x",
        [{ product_id: "x", filter_id: "y", quantity_per_change: null, is_required: null }],
        () => false,
      ),
    ).toEqual([f("y", 1)]);
  });
});

describe("diaDeCarga", () => {
  it("tarde = mañana; mañana = hoy (también en fin de mes)", () => {
    expect(diaDeCarga("tarde", "2026-11-30", sumar)).toBe("2026-12-01");
    expect(diaDeCarga("manana", "2026-11-30", sumar)).toBe("2026-11-30");
  });
});

describe("lineasConfirmadas", () => {
  it("quita ceros, junta repetidas y pone tope de 500", () => {
    expect(lineasConfirmadas([p("a", 0), p("b", 300), p("b", 300), f("c", 2)])).toEqual([p("b", 500), f("c", 2)]);
  });
});
