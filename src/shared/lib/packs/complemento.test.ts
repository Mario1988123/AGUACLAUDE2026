import { describe, it, expect } from "vitest";
import {
  claveCoincide,
  elegirEquipoMantenimiento,
  etiquetaParteDelPack,
  idsPackCompleto,
  lineaQueLlevaMantenimiento,
  lineasConPrecio,
  llevaMantenimiento,
  normalizarLineasPack,
  parteConMantenimiento,
  rolDeLinea,
  sonComplementarios,
  textoOfertaComplemento,
  validarComplementos,
  type InfoComplemento,
} from "./complemento";

function info(p: Partial<InfoComplemento> & { id: string }): InfoComplemento {
  return {
    category_id: null,
    tipo: null,
    claves: [],
    complementa_claves: [],
    complemento_de_productos: [],
    complemento_de_categorias: [],
    ...p,
  };
}

describe("rolDeLinea", () => {
  it("sin padre no hay rol", () => {
    expect(rolDeLinea(null, "complemento")).toBeNull();
  });
  it("con padre es extra salvo que se pida complemento", () => {
    expect(rolDeLinea(0, null)).toBe("extra");
    expect(rolDeLinea(0, "lo-que-sea")).toBe("extra");
    expect(rolDeLinea(0, "complemento")).toBe("complemento");
  });
});

describe("normalizarLineasPack", () => {
  it("el complemento va a precio incluido (cuota 0) y el extra conserva su precio", () => {
    const out = normalizarLineasPack([
      { parent_index: null, pack_role: null, unit_price_cents: 4990 },
      { parent_index: 0, pack_role: "complemento" as const, unit_price_cents: 2990 },
      { parent_index: 0, pack_role: null, unit_price_cents: 500 },
    ]);
    expect(out[0]).toMatchObject({ pack_role: null, unit_price_cents: 4990 });
    expect(out[1]).toMatchObject({ pack_role: "complemento", unit_price_cents: 0 });
    expect(out[2]).toMatchObject({ pack_role: "extra", unit_price_cents: 500 });
  });
  it("un padre inválido (sí mismo, fuera de rango o que ya cuelga) deja la línea suelta", () => {
    const out = normalizarLineasPack([
      { parent_index: 0, pack_role: "complemento" as const, unit_price_cents: 100 },
      { parent_index: 9, pack_role: "complemento" as const, unit_price_cents: 200 },
      { parent_index: null, pack_role: null, unit_price_cents: 300 },
      { parent_index: 2, pack_role: null, unit_price_cents: 400 },
      { parent_index: 3, pack_role: "complemento" as const, unit_price_cents: 500 },
    ]);
    expect(out[0]).toMatchObject({ parent_index: null, pack_role: null, unit_price_cents: 100 });
    expect(out[1]).toMatchObject({ parent_index: null, pack_role: null, unit_price_cents: 200 });
    expect(out[3]).toMatchObject({ parent_index: 2, pack_role: "extra" });
    // Cuelga de una línea que ya es extra: packs dentro de packs no.
    expect(out[4]).toMatchObject({ parent_index: null, pack_role: null, unit_price_cents: 500 });
  });
  it("lineasConPrecio deja fuera el complemento para los suelos de precio", () => {
    const out = lineasConPrecio([
      { pack_role: null },
      { pack_role: "complemento" as const },
      { pack_role: "extra" as const },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("compatibilidad", () => {
  it("comodín final", () => {
    expect(claveCoincide("osmosis*", "osmosis_compact")).toBe(true);
    expect(claveCoincide("osmosis*", "osmosis")).toBe(true);
    expect(claveCoincide("osmosis", "osmosis_compact")).toBe(false);
    expect(claveCoincide("filters", "Filters")).toBe(true);
  });
  it("por categoría global y en las dos direcciones", () => {
    const horeca = info({ id: "h", claves: ["horeca"], complementa_claves: ["osmosis*", "filters"] });
    const osmo = info({ id: "o", claves: ["osmosis_compact", "osmosis"] });
    const fuente = info({ id: "f", claves: ["dispensers"] });
    expect(sonComplementarios(horeca, osmo)).toBe(true);
    expect(sonComplementarios(osmo, horeca)).toBe(true);
    expect(sonComplementarios(horeca, fuente)).toBe(false);
  });
  it("por regla de producto (relacion = complemento)", () => {
    const a = info({ id: "a", complemento_de_productos: ["b"] });
    const b = info({ id: "b" });
    const c = info({ id: "c", category_id: "cat1" });
    const d = info({ id: "d", complemento_de_categorias: ["cat1"] });
    expect(sonComplementarios(b, a)).toBe(true);
    expect(sonComplementarios(c, d)).toBe(true);
    expect(sonComplementarios(a, c)).toBe(false);
  });
  it("sin reglas sembradas: horeca ↔ osmosis por tipo", () => {
    expect(sonComplementarios(info({ id: "h", tipo: "horeca" }), info({ id: "o", tipo: "osmosis" }))).toBe(true);
    expect(sonComplementarios(info({ id: "h", tipo: "horeca" }), info({ id: "f", tipo: "fuente" }))).toBe(false);
    expect(sonComplementarios(info({ id: "x", tipo: "horeca" }), info({ id: "x", tipo: "osmosis" }))).toBe(false);
  });
  it("textos de la oferta", () => {
    expect(textoOfertaComplemento("horeca")).toBe("Añade el equipo que da el agua (ósmosis / UF)");
    expect(textoOfertaComplemento("osmosis")).toBe("Equipo complementario: Horeca");
    expect(etiquetaParteDelPack("complemento")).toBe("Equipo complementario");
    expect(etiquetaParteDelPack(null)).toBe("Extra del pack");
  });
});

describe("elegirEquipoMantenimiento", () => {
  it("Horeca + ósmosis complemento: las visitas van a la ósmosis", () => {
    const r = elegirEquipoMantenimiento([
      { id: "h", parent_equipment_id: null, pack_role: null, tipo: "horeca" },
      { id: "o", parent_equipment_id: "h", pack_role: "complemento", tipo: "osmosis" },
    ]);
    expect(r).toEqual({ id: "o", sinMantenimiento: false });
  });
  it("ósmosis principal con grifo extra: la ósmosis", () => {
    const r = elegirEquipoMantenimiento([
      { id: "g", parent_equipment_id: "o", pack_role: "extra", tipo: null },
      { id: "o", parent_equipment_id: null, pack_role: null, tipo: "osmosis" },
    ]);
    expect(r.id).toBe("o");
  });
  it("datos de hoy (sin rol): el principal, no el extra", () => {
    const r = elegirEquipoMantenimiento([
      { id: "x", parent_equipment_id: "p", pack_role: null, tipo: null },
      { id: "p", parent_equipment_id: null, pack_role: null, tipo: null },
    ]);
    expect(r.id).toBe("p");
  });
  it("solo un Horeca: no se crean visitas", () => {
    const r = elegirEquipoMantenimiento([
      { id: "h", parent_equipment_id: null, pack_role: null, tipo: "horeca" },
    ]);
    expect(r).toEqual({ id: null, sinMantenimiento: true });
  });
  it("sin equipos: como antes (visitas sin equipo)", () => {
    expect(elegirEquipoMantenimiento([])).toEqual({ id: null, sinMantenimiento: false });
  });
  it("llevaMantenimiento", () => {
    expect(llevaMantenimiento({ id: "a", parent_equipment_id: null, pack_role: null, tipo: "horeca" })).toBe(false);
    expect(llevaMantenimiento({ id: "a", parent_equipment_id: "p", pack_role: "extra", tipo: "osmosis" })).toBe(false);
    expect(llevaMantenimiento({ id: "a", parent_equipment_id: "p", pack_role: "complemento", tipo: "osmosis" })).toBe(true);
  });
});

describe("lineaQueLlevaMantenimiento", () => {
  it("salta el Horeca aunque vaya primero", () => {
    const l = lineaQueLlevaMantenimiento([
      { id: 1, maintenance_included: true, pack_role: null, tipo: "horeca", maintenance_periodicity_months: 12 },
      { id: 2, maintenance_included: true, pack_role: "complemento" as const, tipo: "osmosis", maintenance_periodicity_months: 6 },
    ]);
    expect(l?.id).toBe(2);
  });
  it("sin mantenimiento incluido: null", () => {
    expect(lineaQueLlevaMantenimiento([{ maintenance_included: false, tipo: "osmosis" }])).toBeNull();
  });
});

describe("idsPackCompleto", () => {
  const filas = [
    { id: "h", parent_equipment_id: null, pack_role: null },
    { id: "o", parent_equipment_id: "h", pack_role: "complemento" as const },
    { id: "g", parent_equipment_id: "h", pack_role: "extra" as const },
    { id: "s", parent_equipment_id: null, pack_role: null },
  ];
  it("elegir el complemento arrastra el pack entero", () => {
    expect(idsPackCompleto(["o"], filas)).toEqual(["o", "h", "g"]);
  });
  it("elegir el principal arrastra complementos y extras", () => {
    expect(idsPackCompleto(["h"], filas)).toEqual(["h", "o", "g"]);
  });
  it("un equipo suelto no cambia y no se duplica nada", () => {
    expect(idsPackCompleto(["s", "h", "o"], filas)).toEqual(["s", "h", "o", "g"]);
  });
  it("un extra elegido solo se retira solo", () => {
    expect(idsPackCompleto(["g"], filas)).toEqual(["g"]);
  });
  it("un pack sin complemento (datos de hoy) no se amplía", () => {
    const viejas = [
      { id: "p", parent_equipment_id: null, pack_role: null },
      { id: "x", parent_equipment_id: "p", pack_role: null },
    ];
    expect(idsPackCompleto(["p"], viejas)).toEqual(["p"]);
    expect(idsPackCompleto(["x"], viejas)).toEqual(["x"]);
  });
});

describe("parteConMantenimiento", () => {
  it("Horeca con complemento: el mantenimiento va al complemento", () => {
    expect(parteConMantenimiento("horeca", true)).toBe("complemento");
    expect(parteConMantenimiento("horeca", false)).toBe("principal");
    expect(parteConMantenimiento("osmosis", true)).toBe("principal");
  });
});

describe("validarComplementos (el servidor no se fía del navegador)", () => {
  const items = [
    { product_id: "horeca", parent_index: null, pack_role: null, unit_price_cents: 8990 },
    { product_id: "osmo", parent_index: 0, pack_role: "complemento" as const, unit_price_cents: 2990 },
    { product_id: "grifo", parent_index: 0, pack_role: "complemento" as const, unit_price_cents: 500 },
  ];
  const compat = (a: string, b: string) => a === "horeca" && b === "osmo";
  it("un complemento incompatible baja a extra y conserva su precio", () => {
    const out = normalizarLineasPack(validarComplementos(items, true, compat));
    expect(out[1]).toMatchObject({ pack_role: "complemento", unit_price_cents: 0 });
    expect(out[2]).toMatchObject({ pack_role: "extra", unit_price_cents: 500 });
  });
  it("sin migración no se acepta ningún complemento", () => {
    const out = normalizarLineasPack(validarComplementos(items, false, compat));
    expect(out[1]).toMatchObject({ pack_role: "extra", unit_price_cents: 2990 });
    expect(out[2]).toMatchObject({ pack_role: "extra", unit_price_cents: 500 });
  });
  it("un complemento sin padre queda suelto con su precio", () => {
    const out = normalizarLineasPack(
      validarComplementos(
        [{ product_id: "osmo", parent_index: null, pack_role: "complemento" as const, unit_price_cents: 2990 }],
        true,
        () => true,
      ),
    );
    expect(out[0]).toMatchObject({ pack_role: null, unit_price_cents: 2990 });
  });
});

describe("lineaQueLlevaMantenimiento con datos de siempre", () => {
  it("sin complemento ni Horeca: la primera línea con mantenimiento, aunque cuelgue", () => {
    const l = lineaQueLlevaMantenimiento([
      { id: 1, maintenance_included: false, parent_item_id: null, pack_role: null, tipo: "osmosis" },
      { id: 2, maintenance_included: true, parent_item_id: "a", pack_role: null, tipo: null },
      { id: 3, maintenance_included: true, parent_item_id: null, pack_role: null, tipo: "osmosis" },
    ]);
    expect(l?.id).toBe(2);
  });
  it("con complemento: una línea colgada sin rol cuenta como extra", () => {
    const l = lineaQueLlevaMantenimiento([
      { id: 1, maintenance_included: false, parent_item_id: null, pack_role: null, tipo: "horeca" },
      { id: 2, maintenance_included: true, parent_item_id: "h", pack_role: null, tipo: "osmosis" },
      { id: 3, maintenance_included: true, parent_item_id: "h", pack_role: "complemento" as const, tipo: "osmosis" },
    ]);
    expect(l?.id).toBe(3);
  });
});
