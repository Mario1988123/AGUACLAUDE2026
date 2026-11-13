import { describe, expect, it } from "vitest";
import {
  centimosAEuros,
  cobroTrasQuitarPagado,
  combinarPagoOficina,
  diferenciaMembrana,
  estadoMantIncluido,
  eurosACentimos,
  indiceVisita,
  nDesdeAnioCobro,
  nDesdeMeses,
  pagoEfectivo,
  precioAplicado,
  preciosDelModelo,
  proximoAniversario,
  textoEstado,
  totalConIva,
  type EntradaEstado,
  type PreciosTarifa,
} from "./logica";

const base: EntradaEstado = {
  modalidad: "cash",
  activo: true,
  n: 3,
  installedAt: "2026-07-31",
  fechaVisita: null,
  hoy: "2026-11-13",
};

describe("indiceVisita", () => {
  it("la del mes 12 es la 1 y la del 24 la 2", () => {
    expect(indiceVisita("2026-07-31", "2027-07-31")).toBe(1);
    expect(indiceVisita("2026-07-31", "2028-07-31")).toBe(2);
  });
  it("tolera visitas adelantadas o retrasadas unas semanas", () => {
    expect(indiceVisita("2026-07-31", "2029-07-05")).toBe(3);
    expect(indiceVisita("2026-07-31", "2029-08-25")).toBe(3);
  });
  it("una visita antes del primer aniversario cuenta como la 1", () => {
    expect(indiceVisita("2026-07-31", "2026-09-01")).toBe(1);
  });
  it("instalación a finales de diciembre", () => {
    expect(indiceVisita("2026-12-30", "2028-01-05")).toBe(1);
    expect(indiceVisita("2026-12-30", "2027-12-20")).toBe(1);
  });
  it("29 de febrero", () => {
    expect(indiceVisita("2028-02-29", "2029-02-28")).toBe(1);
    expect(indiceVisita("2028-02-29", "2032-02-29")).toBe(4);
  });
  it("fecha mal escrita → null", () => {
    expect(indiceVisita("xx", "2029-01-01")).toBeNull();
  });
});

describe("estadoMantIncluido", () => {
  it("caso Machado: N=3 → gratis 2027, 2028 y 2029; paga en 2030", () => {
    const r27 = estadoMantIncluido({ ...base, fechaVisita: "2027-07-20" });
    expect(r27.estado).toBe("incluido");
    expect(r27.seCobra).toBe(false);
    const r29 = estadoMantIncluido({ ...base, fechaVisita: "2029-08-10" });
    expect(r29.estado).toBe("ultima_incluida");
    expect(r29.seCobra).toBe(false);
    const r30 = estadoMantIncluido({ ...base, fechaVisita: "2030-07-25" });
    expect(r30.estado).toBe("a_pagar");
    expect(r30.seCobra).toBe(true);
    expect(r30.anioHasta).toBe(2029);
    expect(r30.anioPaga).toBe(2030);
  });
  it("renting de 48 meses: N=3, la del mes 48 se paga", () => {
    const n = nDesdeMeses(48)!;
    expect(n).toBe(3);
    const e = { ...base, modalidad: "renting" as const, n, installedAt: "2025-03-10" };
    expect(estadoMantIncluido({ ...e, fechaVisita: "2028-03-10" }).seCobra).toBe(false);
    expect(estadoMantIncluido({ ...e, fechaVisita: "2029-03-10" }).seCobra).toBe(true);
  });
  it("N = 0: paga desde la primera visita", () => {
    const r = estadoMantIncluido({ ...base, n: 0, fechaVisita: "2027-07-31" });
    expect(r.estado).toBe("a_pagar");
    expect(r.anioHasta).toBeNull();
    expect(r.anioPaga).toBe(2027);
  });
  it("alquiler de alta: incluido sin N", () => {
    const r = estadoMantIncluido({ ...base, modalidad: "rental", n: null });
    expect(r.estado).toBe("incluido_alquiler");
    expect(textoEstado(r, "rental")).toBe("Mant. incluido (alquiler)");
  });
  it("alquiler dado de baja sin N → sin dato", () => {
    const r = estadoMantIncluido({ ...base, modalidad: "rental", activo: false, n: null });
    expect(r.estado).toBe("sin_dato");
  });
  it("sin N: solo avisa en venta", () => {
    const r = estadoMantIncluido({ ...base, n: null });
    expect(r.estado).toBe("sin_dato");
    expect(textoEstado(r, "cash")).toBe("Falta nº de mantenimientos incluidos");
    expect(textoEstado(r, "renting")).toBeNull();
  });
  it("sin fecha de instalación → sin dato", () => {
    const r = estadoMantIncluido({ ...base, installedAt: null });
    expect(r.falta).toBe("instalacion");
  });
  it("sin visita programada usa el próximo aniversario", () => {
    // Hoy 2030-01-10 → próximo aniversario 2030-07-31 → k=4 > 3.
    const r = estadoMantIncluido({ ...base, hoy: "2030-01-10" });
    expect(r.estado).toBe("a_pagar");
    expect(textoEstado(r, "cash")).toBe("EMPEZAR A PAGAR · desde 2030");
  });
});

describe("conversiones de N", () => {
  it("«cobrar a partir de 2029» con instalación de 2026 → N=2", () => {
    expect(nDesdeAnioCobro(2029, "2026-05-01")).toBe(2);
  });
  it("año de cobro anterior a la instalación → null", () => {
    expect(nDesdeAnioCobro(2026, "2026-05-01")).toBeNull();
  });
  it("meses no válidos", () => {
    expect(nDesdeMeses(0)).toBeNull();
    expect(nDesdeMeses(12)).toBe(0);
  });
});

describe("proximoAniversario", () => {
  it("hoy mismo cuenta", () => {
    expect(proximoAniversario("2026-07-31", "2027-07-31")).toBe("2027-07-31");
  });
  it("29-feb en año no bisiesto → 28-feb", () => {
    expect(proximoAniversario("2028-02-29", "2028-06-01")).toBe("2029-02-28");
  });
});

describe("precios", () => {
  const vacio: PreciosTarifa = { solo_filtros: null, filtros_membrana: null };
  it("equipo > cliente > modelo > empresa", () => {
    const eq = { solo_filtros: 7000, filtros_membrana: null };
    const cl = { solo_filtros: 8000, filtros_membrana: 13000 };
    const mo = { solo_filtros: 6000, filtros_membrana: 11000 };
    const em = { solo_filtros: 7500, filtros_membrana: 12000 };
    const p = (equipo = vacio, cliente = vacio, modelo = vacio, empresa = vacio) => ({
      equipo,
      cliente,
      modelo,
      empresa,
    });
    expect(precioAplicado("solo_filtros", p(eq, cl, mo, em))).toEqual({ cents: 7000, origen: "equipo" });
    expect(precioAplicado("filtros_membrana", p(eq, cl, mo, em))).toEqual({ cents: 13000, origen: "cliente" });
    expect(precioAplicado("solo_filtros", p(vacio, vacio, mo, em))).toEqual({ cents: 6000, origen: "modelo" });
    expect(precioAplicado("filtros_membrana", p(eq, vacio, mo, em))).toEqual({ cents: 11000, origen: "modelo" });
    expect(precioAplicado("filtros_membrana", p(vacio, vacio, vacio, em))).toEqual({
      cents: 12000,
      origen: "empresa",
    });
    expect(precioAplicado("solo_filtros", p())).toEqual({ cents: null, origen: null });
  });
  it("el cliente manda sobre el modelo aunque el modelo sea más barato", () => {
    const cl = { solo_filtros: 9000, filtros_membrana: null };
    const mo = { solo_filtros: 5000, filtros_membrana: 10000 };
    const niveles = { equipo: vacio, cliente: cl, modelo: mo, empresa: vacio };
    expect(precioAplicado("solo_filtros", niveles)).toEqual({ cents: 9000, origen: "cliente" });
    expect(precioAplicado("filtros_membrana", niveles)).toEqual({ cents: 10000, origen: "modelo" });
  });
  it("0 € es un precio (no cae al siguiente nivel)", () => {
    const niveles = {
      equipo: vacio,
      cliente: { solo_filtros: 0, filtros_membrana: null },
      modelo: { solo_filtros: 6000, filtros_membrana: null },
      empresa: vacio,
    };
    expect(precioAplicado("solo_filtros", niveles)).toEqual({ cents: 0, origen: "cliente" });
  });
});

describe("precio del modelo (variante → gama)", () => {
  const productos = new Map([
    ["gama", { gama_id: null, precios: { solo_filtros: 6000, filtros_membrana: 11000 } }],
    ["var-propia", { gama_id: "gama", precios: { solo_filtros: 6500, filtros_membrana: 11500 } }],
    ["var-vacia", { gama_id: "gama", precios: { solo_filtros: null, filtros_membrana: null } }],
    ["var-mixta", { gama_id: "gama", precios: { solo_filtros: null, filtros_membrana: 12500 } }],
    ["gama-vacia", { gama_id: null, precios: { solo_filtros: null, filtros_membrana: null } }],
    ["var-de-vacia", { gama_id: "gama-vacia", precios: { solo_filtros: null, filtros_membrana: 9000 } }],
    ["var-huerfana", { gama_id: "no-existe", precios: { solo_filtros: null, filtros_membrana: null } }],
  ]);
  it("la gama usa su propio precio", () => {
    expect(preciosDelModelo("gama", productos)).toEqual({ solo_filtros: 6000, filtros_membrana: 11000 });
  });
  it("la variante con precio manda sobre la gama", () => {
    expect(preciosDelModelo("var-propia", productos)).toEqual({ solo_filtros: 6500, filtros_membrana: 11500 });
  });
  it("variante vacía = el de la gama", () => {
    expect(preciosDelModelo("var-vacia", productos)).toEqual({ solo_filtros: 6000, filtros_membrana: 11000 });
  });
  it("hereda tarifa a tarifa", () => {
    expect(preciosDelModelo("var-mixta", productos)).toEqual({ solo_filtros: 6000, filtros_membrana: 12500 });
  });
  it("gama sin precio → vacío (cae a la empresa)", () => {
    expect(preciosDelModelo("var-de-vacia", productos)).toEqual({ solo_filtros: null, filtros_membrana: 9000 });
    const niveles = {
      equipo: { solo_filtros: null, filtros_membrana: null },
      cliente: { solo_filtros: null, filtros_membrana: null },
      modelo: preciosDelModelo("var-de-vacia", productos),
      empresa: { solo_filtros: 7500, filtros_membrana: 12000 },
    };
    expect(precioAplicado("solo_filtros", niveles)).toEqual({ cents: 7500, origen: "empresa" });
    expect(precioAplicado("filtros_membrana", niveles)).toEqual({ cents: 9000, origen: "modelo" });
  });
  it("sin producto, producto desconocido o gama que no está → vacío", () => {
    const vacio = { solo_filtros: null, filtros_membrana: null };
    expect(preciosDelModelo(null, productos)).toEqual(vacio);
    expect(preciosDelModelo("otro", productos)).toEqual(vacio);
    expect(preciosDelModelo("var-huerfana", productos)).toEqual(vacio);
  });
});

describe("precios (formato)", () => {
  it("IVA redondeado una vez", () => {
    expect(totalConIva(7500, 21)).toBe(9075);
    expect(totalConIva(12000, 21)).toBe(14520);
    expect(totalConIva(333, 21)).toBe(403);
  });
  it("euros ↔ céntimos", () => {
    expect(eurosACentimos("75")).toBe(7500);
    expect(eurosACentimos("75,5")).toBe(7550);
    expect(eurosACentimos("90.75 €")).toBe(9075);
    expect(eurosACentimos("")).toBeNull();
    expect(eurosACentimos("abc")).toBeNull();
    expect(eurosACentimos("1,234")).toBeNull();
    expect(centimosAEuros(7550)).toBe("75,50");
    expect(centimosAEuros(7500)).toBe("75");
  });
});

describe("cobro de la visita", () => {
  it("lo marcado por una persona manda sobre lo derivado", () => {
    expect(pagoEfectivo("pagado_oficina", true)).toBe("pagado_oficina");
    expect(pagoEfectivo("incluido", true)).toBe("pendiente");
    expect(pagoEfectivo(null, false)).toBe("incluido");
    expect(pagoEfectivo("pendiente", false)).toBe("pendiente");
    // Cerradas: no se cobra hacia atrás.
    expect(pagoEfectivo("incluido", true, true)).toBe("incluido");
    expect(pagoEfectivo("no_cobrado", true, true)).toBe("no_cobrado");
  });
  it("diferencia por membrana", () => {
    expect(diferenciaMembrana("solo_filtros", "filtros_membrana", 9000, 12000, null)).toBe(3000);
    expect(diferenciaMembrana("solo_filtros", "filtros_membrana", 9000, 12000, 7500)).toBe(4500);
    expect(diferenciaMembrana("solo_filtros", "solo_filtros", 9000, 12000, null)).toBeNull();
    expect(diferenciaMembrana("filtros_membrana", "filtros_membrana", 9000, 12000, null)).toBeNull();
    expect(diferenciaMembrana(null, "filtros_membrana", 9000, 12000, null)).toBeNull();
  });
});

describe("combinarPagoOficina (M4)", () => {
  const nuevo = { tarifa: "filtros_membrana" as const, cents: 3000, metodo: "card" };
  it("sin pago anterior: lo nuevo tal cual", () => {
    expect(combinarPagoOficina(null, nuevo)).toEqual(nuevo);
  });
  it("con pago anterior: suma importes y manda lo nuevo", () => {
    expect(
      combinarPagoOficina({ tarifa: "solo_filtros", cents: 6000, metodo: "cash" }, nuevo),
    ).toEqual({ tarifa: "filtros_membrana", cents: 9000, metodo: "card" });
  });
  it("si falta tarifa o método nuevos, conserva los anteriores", () => {
    expect(
      combinarPagoOficina(
        { tarifa: "solo_filtros", cents: 6000, metodo: "cash" },
        { tarifa: null, cents: 3000, metodo: null },
      ),
    ).toEqual({ tarifa: "solo_filtros", cents: 9000, metodo: "cash" });
  });
  it("si una parte del importe es desconocida, el total es desconocido", () => {
    expect(
      combinarPagoOficina({ tarifa: "solo_filtros", cents: null, metodo: null }, nuevo).cents,
    ).toBeNull();
    expect(
      combinarPagoOficina(
        { tarifa: "solo_filtros", cents: 6000, metodo: null },
        { tarifa: null, cents: null, metodo: null },
      ).cents,
    ).toBeNull();
  });
});

describe("cobroTrasQuitarPagado (I2)", () => {
  it("restaura lo guardado en el evento", () => {
    expect(cobroTrasQuitarPagado({ is_charged: false, importe_pendiente_cents: null }, 5000)).toEqual({
      is_charged: false,
      importe_pendiente_cents: null,
    });
    expect(cobroTrasQuitarPagado({ is_charged: true, importe_pendiente_cents: 1200 }, null)).toEqual({
      is_charged: true,
      importe_pendiente_cents: 1200,
    });
  });
  it("sin evento (o mal formado): is_charged = tiene precio y sin pendiente", () => {
    expect(cobroTrasQuitarPagado(null, 5000)).toEqual({ is_charged: true, importe_pendiente_cents: null });
    expect(cobroTrasQuitarPagado(undefined, null)).toEqual({ is_charged: false, importe_pendiente_cents: null });
    expect(cobroTrasQuitarPagado({ is_charged: "si" }, null)).toEqual({
      is_charged: false,
      importe_pendiente_cents: null,
    });
    expect(cobroTrasQuitarPagado({ is_charged: true, importe_pendiente_cents: -5 }, 100)).toEqual({
      is_charged: true,
      importe_pendiente_cents: null,
    });
  });
});
