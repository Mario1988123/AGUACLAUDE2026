import { describe, expect, it } from "vitest";
import {
  anadirNota,
  decidirContrato,
  estadoStockDeEquipo,
  pruebaRetirable,
  validarRetiradaPrueba,
  clasificarOrdenesAbiertas,
  instanteRetirada,
  leerParametrosRetirada,
  necesitaAlmacen,
  notasAlCerrar,
  puedeRetirar,
  validarRetiradaManual,
} from "./retirada-logica";

const CLI = "11111111-1111-4111-8111-111111111111";
const EQ1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EQ2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const notasOrden = (ids: string[], almacen = ALM, estado = "used") =>
  [
    `Desinstalación de ${ids.length} equipo(s):`,
    ...ids.map((id) => `  - Osmosis (S/N X1) #${id}`),
    `destination_warehouse_id=${almacen}`,
    `default_state=${estado}`,
  ].join("\n");

describe("leerParametrosRetirada", () => {
  it("lee destino, estado y equipos de las notas de la orden", () => {
    const p = leerParametrosRetirada(notasOrden([EQ1, EQ2], ALM, "damaged"));
    expect(p.destinoAlmacenId).toBe(ALM);
    expect(p.estadoVuelta).toBe("damaged");
    expect(p.equipoIds).toEqual([EQ1, EQ2]);
  });

  it("sin notas: sin destino, estado usado y sin equipos", () => {
    expect(leerParametrosRetirada(null)).toEqual({
      destinoAlmacenId: null,
      estadoVuelta: "used",
      equipoIds: [],
    });
  });

  it("no repite equipos", () => {
    expect(leerParametrosRetirada(`#${EQ1}\n#${EQ1}`).equipoIds).toEqual([EQ1]);
  });
});

describe("notasAlCerrar", () => {
  it("en una desinstalación conserva las notas originales (destino y #UUID)", () => {
    const previas = notasOrden([EQ1]);
    const r = notasAlCerrar("uninstall", previas, "[RETIRADA] Estado equipo: operative");
    expect(r).toContain(previas);
    expect(r).toContain("[RETIRADA]");
    expect(leerParametrosRetirada(r).equipoIds).toEqual([EQ1]);
    expect(leerParametrosRetirada(r).destinoAlmacenId).toBe(ALM);
  });

  it("en una desinstalación sin parte nuevo deja las originales", () => {
    expect(notasAlCerrar("uninstall", "abc", null)).toBe("abc");
  });

  it("en el resto de tipos sustituye como siempre", () => {
    expect(notasAlCerrar("normal", "viejas", "nuevas")).toBe("nuevas");
    expect(notasAlCerrar("normal", "viejas", null)).toBeNull();
  });
});

describe("validarRetiradaManual", () => {
  const base = {
    customer_id: CLI,
    equipment_ids: [EQ1],
    fecha_retirada: "2026-11-09",
    destination_warehouse_id: ALM,
    estado_equipo: "operative",
    motivo: "Lo devolvió en tienda",
  };
  const HOY = "2026-11-09";

  it("acepta una entrada correcta y normaliza", () => {
    const r = validarRetiradaManual({ ...base, equipment_ids: [EQ1, EQ1] }, HOY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos.equipment_ids).toEqual([EQ1]);
      expect(r.datos.motivo).toBe("Lo devolvió en tienda");
    }
  });

  it("rechaza fecha futura", () => {
    const r = validarRetiradaManual({ ...base, fecha_retirada: "2026-11-10" }, HOY);
    expect(r).toEqual({ ok: false, error: "La fecha de retirada no puede ser futura" });
  });

  it("rechaza fecha inexistente", () => {
    expect(validarRetiradaManual({ ...base, fecha_retirada: "2026-02-30" }, HOY).ok).toBe(false);
  });

  it("exige motivo", () => {
    expect(validarRetiradaManual({ ...base, motivo: "   " }, HOY).ok).toBe(false);
    expect(validarRetiradaManual({ ...base, motivo: "abc" }, HOY).ok).toBe(false);
  });

  it("exige al menos un equipo válido", () => {
    expect(validarRetiradaManual({ ...base, equipment_ids: [] }, HOY).ok).toBe(false);
    expect(validarRetiradaManual({ ...base, equipment_ids: ["x"] }, HOY).ok).toBe(false);
  });

  it("rechaza estado o destino desconocidos", () => {
    expect(validarRetiradaManual({ ...base, estado_equipo: "used" }, HOY).ok).toBe(false);
    expect(
      validarRetiradaManual(
        { ...base, destinos: [{ equipment_id: EQ1, destino: "vendido" }] },
        HOY,
      ).ok,
    ).toBe(false);
  });
});

describe("necesitaAlmacen", () => {
  it("solo si algún equipo nuestro vuelve al almacén", () => {
    const eqs = [
      { id: EQ1, product_id: "p1" },
      { id: EQ2, product_id: null },
    ];
    expect(necesitaAlmacen(eqs, new Map())).toBe(true);
    expect(necesitaAlmacen(eqs, new Map([[EQ1, "lost"]]))).toBe(false);
    expect(necesitaAlmacen([{ id: EQ2, product_id: null }], new Map())).toBe(false);
  });
});

describe("clasificarOrdenesAbiertas", () => {
  const o = (id: string, ids: string[]) => ({ id, reference_code: id, notes: notasOrden(ids) });

  it("cancela las cubiertas, bloquea las mixtas e ignora las ajenas", () => {
    const r = clasificarOrdenesAbiertas(
      [o("A", [EQ1]), o("B", [EQ1, EQ2]), o("C", [EQ2]), o("D", [])],
      [EQ1],
    );
    expect(r.cancelar.map((x) => x.id)).toEqual(["A"]);
    expect(r.bloquean.map((x) => x.id)).toEqual(["B"]);
  });

  it("si se seleccionan todos los equipos de la orden, se cancela", () => {
    const r = clasificarOrdenesAbiertas([o("B", [EQ1, EQ2])], [EQ1, EQ2]);
    expect(r.cancelar).toHaveLength(1);
    expect(r.bloquean).toHaveLength(0);
  });
});

describe("instanteRetirada", () => {
  const aUtc = (s: string) => `${s}:00.000Z`;
  it("hoy → ahora; día pasado → mediodía de Madrid", () => {
    const ahora = new Date("2026-11-09T15:30:00.000Z");
    expect(instanteRetirada("2026-11-09", "2026-11-09", ahora, aUtc)).toBe(ahora.toISOString());
    expect(instanteRetirada("2026-11-01", "2026-11-09", ahora, aUtc)).toBe("2026-11-01T12:00:00.000Z");
  });
});

describe("puedeRetirar", () => {
  it("admin, director técnico y superadmin sí; el resto no", () => {
    expect(puedeRetirar({ is_superadmin: true, roles: [] })).toBe(true);
    expect(puedeRetirar({ is_superadmin: false, roles: ["company_admin"] })).toBe(true);
    expect(puedeRetirar({ is_superadmin: false, roles: ["technical_director"] })).toBe(true);
    expect(puedeRetirar({ is_superadmin: false, roles: ["installer", "commercial"] })).toBe(false);
  });
});

describe("estado del equipo → estado de stock", () => {
  it("operativo → usado; dañado y para revisar → dañado (con nota)", () => {
    expect(estadoStockDeEquipo("operative")).toEqual({ estado: "used", nota: null });
    expect(estadoStockDeEquipo("damaged")).toEqual({ estado: "damaged", nota: null });
    expect(estadoStockDeEquipo("needs_review")).toEqual({ estado: "damaged", nota: "PARA REVISAR" });
  });

  it("la validación devuelve el estado traducido", () => {
    const r = validarRetiradaManual(
      {
        customer_id: CLI,
        equipment_ids: [EQ1],
        fecha_retirada: "2026-11-01",
        estado_equipo: "needs_review",
        motivo: "Lo trajo a tienda",
      },
      "2026-11-09",
    );
    expect(r.ok && r.datos.estado_vuelta).toBe("damaged");
    expect(r.ok && r.datos.nota_estado).toBe("PARA REVISAR");
  });
});

describe("decidirContrato", () => {
  it("solo finaliza si no le quedan otros equipos activos", () => {
    expect(decidirContrato(0)).toBe("finalizar");
    expect(decidirContrato(1)).toBe("mantener");
  });
});

describe("pruebas gratuitas", () => {
  it("solo se retiran si el equipo está en casa del cliente", () => {
    expect(pruebaRetirable("installed")).toBe(true);
    expect(pruebaRetirable("expired")).toBe(true);
    expect(pruebaRetirable("rejected")).toBe(true);
    expect(pruebaRetirable("scheduled")).toBe(false);
    expect(pruebaRetirable("removed")).toBe(false);
  });

  it("validarRetiradaPrueba exige almacén, motivo y fecha no futura", () => {
    const ok = {
      trial_id: CLI,
      fecha_retirada: "2026-11-09",
      destination_warehouse_id: ALM,
      estado_equipo: "operative",
      motivo: "No la quiere",
    };
    expect(validarRetiradaPrueba(ok, "2026-11-09").ok).toBe(true);
    expect(validarRetiradaPrueba({ ...ok, destination_warehouse_id: "" }, "2026-11-09").ok).toBe(false);
    expect(validarRetiradaPrueba({ ...ok, motivo: "" }, "2026-11-09").ok).toBe(false);
    expect(validarRetiradaPrueba({ ...ok, fecha_retirada: "2026-12-01" }, "2026-11-09").ok).toBe(false);
  });
});

describe("anadirNota", () => {
  it("añade debajo o crea la nota", () => {
    expect(anadirNota(null, "x")).toBe("x");
    expect(anadirNota("a", "x")).toBe(["a", "x"].join(String.fromCharCode(10)));
  });
});
