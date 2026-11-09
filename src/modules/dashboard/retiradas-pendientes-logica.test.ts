import { describe, expect, it } from "vitest";
import { retiradasConEquiposActivos } from "./retiradas-pendientes-logica";

const orden = (id: string, cliente: string, fecha = "2026-10-01T10:00:00Z") => ({
  id,
  reference_code: id,
  customer_id: cliente,
  completed_at: fecha,
});

describe("retiradasConEquiposActivos", () => {
  it("orden con sus equipos aún activos → aviso con X retirados / Y activos", () => {
    const r = retiradasConEquiposActivos({
      ordenes: [orden("I-10", "c1")],
      lineas: [{ installation_id: "I-10", product_id: "p", quantity: 2 }],
      equiposDeOrden: new Map([["I-10", ["e1", "e2"]]]),
      activos: [
        { id: "e1", customer_id: "c1", product_id: "p" },
        { id: "e2", customer_id: "c1", product_id: "p" },
        { id: "e3", customer_id: "c1", product_id: "p" },
      ],
      manuales: [],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ retirados: 2, activos: 3 });
  });

  it("orden bien cerrada (sus equipos ya inactivos) aunque quede otra unidad → sin aviso", () => {
    const r = retiradasConEquiposActivos({
      ordenes: [orden("I-11", "c1")],
      lineas: [{ installation_id: "I-11", product_id: "p", quantity: 1 }],
      equiposDeOrden: new Map([["I-11", ["e1"]]]),
      activos: [{ id: "e9", customer_id: "c1", product_id: "p" }],
      manuales: [],
    });
    expect(r).toHaveLength(0);
  });

  it("sin evento: cae a la cuenta por producto", () => {
    const base = {
      ordenes: [orden("I-12", "c1")],
      lineas: [{ installation_id: "I-12", product_id: "p", quantity: 1 }],
      equiposDeOrden: new Map<string, string[]>(),
      manuales: [],
    };
    expect(retiradasConEquiposActivos({ ...base, activos: [{ id: "x", customer_id: "c1", product_id: "p" }] })).toHaveLength(1);
    expect(retiradasConEquiposActivos({ ...base, activos: [] })).toHaveLength(0);
  });

  it("desaparece con una retirada manual posterior del mismo cliente y producto", () => {
    const base = {
      ordenes: [orden("I-14", "c2")],
      lineas: [{ installation_id: "I-14", product_id: "p", quantity: 1 }],
      equiposDeOrden: new Map([["I-14", ["e1"]]]),
      activos: [{ id: "e1", customer_id: "c2", product_id: "p" }],
    };
    expect(
      retiradasConEquiposActivos({
        ...base,
        manuales: [{ customer_id: "c2", created_at: "2026-11-09T10:00:00Z", product_ids: ["p"] }],
      }),
    ).toHaveLength(0);
    // Anterior a la orden, de otro producto o de otro cliente: no la resuelve.
    expect(
      retiradasConEquiposActivos({
        ...base,
        manuales: [
          { customer_id: "c2", created_at: "2026-09-01T10:00:00Z", product_ids: ["p"] },
          { customer_id: "c2", created_at: "2026-11-09T10:00:00Z", product_ids: ["q"] },
          { customer_id: "c3", created_at: "2026-11-09T10:00:00Z", product_ids: ["p"] },
        ],
      }),
    ).toHaveLength(1);
  });
});
