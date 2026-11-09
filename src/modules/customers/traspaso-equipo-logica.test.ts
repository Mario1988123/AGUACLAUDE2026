import { describe, expect, it } from "vitest";
import {
  bloqueoPorContratoCompartido,
  contratosConCuotas,
  faltanDatosFacturacion,
  resumenTraspasoEquipo,
  validarMotivo,
  type ConteosTraspaso,
  type ContratoLigado,
} from "./traspaso-equipo-logica";

const k = (o: Partial<ContratoLigado> = {}): ContratoLigado => ({
  id: "k1-xxxxxxxx",
  reference_code: "C-2026-0001",
  plan_type: "rental",
  status: "active",
  financier_id: null,
  otros_equipos: 0,
  ...o,
});

const base = (o: Partial<ConteosTraspaso> = {}): ConteosTraspaso => ({
  origenNombre: "Grupo A SL",
  destinoNombre: "Grupo B SL",
  equipos: 1,
  contratos: [k()],
  instalaciones: 1,
  mantenimientos: 3,
  contratosMantenimiento: 1,
  incidencias: 0,
  apuntesPendientes: 0,
  cobrosFacturadosPendientes: 0,
  mandatosVivos: 1,
  direccion: "copia",
  seSueltaDelPack: false,
  accesoriosQueSeQuedan: 0,
  ...o,
});

describe("validarMotivo", () => {
  it("obligatorio", () => {
    expect(validarMotivo("")).toMatch(/obligatorio/);
    expect(validarMotivo("   abc ")).toMatch(/obligatorio/);
    expect(validarMotivo(null)).toMatch(/obligatorio/);
  });
  it("válido y con tope", () => {
    expect(validarMotivo("Alta en la sociedad equivocada")).toBeNull();
    expect(validarMotivo("x".repeat(501))).toMatch(/500/);
  });
});

describe("bloqueoPorContratoCompartido", () => {
  it("un contrato que cubre otros equipos que se quedan bloquea", () => {
    expect(bloqueoPorContratoCompartido([k({ otros_equipos: 2 })])).toMatch(/C-2026-0001/);
  });
  it("si viajan todos sus equipos, no bloquea", () => {
    expect(bloqueoPorContratoCompartido([k()])).toBeNull();
  });
  it("un contrato cancelado no bloquea", () => {
    expect(bloqueoPorContratoCompartido([k({ otros_equipos: 1, status: "cancelled" })])).toBeNull();
  });
});

describe("contratosConCuotas", () => {
  it("alquiler y renting sin financiera, firmados o activos", () => {
    const r = contratosConCuotas([
      k({ id: "a" }),
      k({ id: "b", plan_type: "renting" }),
      k({ id: "c", plan_type: "renting", financier_id: "f" }),
      k({ id: "d", plan_type: "cash" }),
      k({ id: "e", status: "completed" }),
      k({ id: "f", status: "signed" }),
    ]);
    expect(r.map((x) => x.id)).toEqual(["a", "b", "f"]);
  });
});

describe("faltanDatosFacturacion", () => {
  const dir = { street: "Calle Mayor 1", postal_code: "28001", city: "Madrid" };
  it("empresa completa", () => {
    expect(
      faltanDatosFacturacion(
        { party_kind: "company", legal_name: "B SL", first_name: null, last_name: null, tax_id: "B12345678" },
        dir,
      ),
    ).toEqual([]);
  });
  it("empresa sin CIF, sin razón social y sin dirección", () => {
    expect(
      faltanDatosFacturacion({ party_kind: "company", legal_name: "", first_name: null, last_name: null, tax_id: null }, null),
    ).toEqual(["CIF", "razón social", "dirección principal (calle, código postal y población)"]);
  });
  it("particular: DNI y nombre", () => {
    expect(
      faltanDatosFacturacion(
        { party_kind: "individual", legal_name: null, first_name: "", last_name: "", tax_id: "12345678A" },
        dir,
      ),
    ).toEqual(["DNI/NIE", "nombre y apellidos"]);
    expect(
      faltanDatosFacturacion(
        { party_kind: "individual", legal_name: null, first_name: "Ana", last_name: "Pérez", tax_id: "12345678Z" },
        dir,
      ),
    ).toEqual([]);
  });
});

describe("resumenTraspasoEquipo", () => {
  it("dice qué se mueve: contrato, mantenimientos y cuotas futuras", () => {
    const r = resumenTraspasoEquipo(base());
    const t = r.mueve.join(" | ");
    expect(t).toMatch(/1 equipo/);
    expect(t).toMatch(/1 contrato \(C-2026-0001\): pasa a ser de Grupo B SL/);
    expect(t).toMatch(/3 mantenimientos/);
    expect(t).toMatch(/1 contrato de mantenimiento/);
    expect(t).toMatch(/próximas cuotas/);
    expect(t).toMatch(/dirección de instalación se copia/);
  });

  it("las facturas emitidas, el PDF y las firmas no se mueven", () => {
    const t = resumenTraspasoEquipo(base()).noMueve.join(" | ");
    expect(t).toMatch(/facturas ya emitidas siguen a nombre de Grupo A SL/);
    expect(t).toMatch(/PDF y las firmas/);
  });

  it("avisa de la revocación del mandato y de que el destino firme el suyo", () => {
    const t = resumenTraspasoEquipo(base()).avisos.join(" | ");
    expect(t).toMatch(/mandato SEPA de Grupo A SL se revoca/);
    expect(t).toMatch(/NO entran en la remesa/);
  });

  it("cuotas ya facturadas pendientes: siguen siendo del origen, por transferencia", () => {
    const t = resumenTraspasoEquipo(base({ cobrosFacturadosPendientes: 2 })).avisos.join(" | ");
    expect(t).toMatch(/2 cuotas facturadas pendientes/);
    expect(t).toMatch(/transferencia/);
  });

  it("sin contrato: no habla de cuotas ni de mandatos", () => {
    const r = resumenTraspasoEquipo(base({ contratos: [], mandatosVivos: 0, instalaciones: 0 }));
    const t = [...r.mueve, ...r.noMueve, ...r.avisos].join(" | ");
    expect(t).not.toMatch(/cuotas/);
    expect(t).not.toMatch(/mandato/);
    expect(t).not.toMatch(/PDF/);
  });

  it("venta al contado: se mueve el contrato pero no hay cuotas", () => {
    const r = resumenTraspasoEquipo(base({ contratos: [k({ plan_type: "cash" })], mandatosVivos: 0 }));
    expect(r.mueve.join(" ")).not.toMatch(/próximas cuotas/);
    expect(r.avisos.join(" ")).not.toMatch(/mandato/);
  });

  it("pack partido y accesorio suelto", () => {
    const r = resumenTraspasoEquipo(base({ seSueltaDelPack: true, accesoriosQueSeQuedan: 2 }));
    expect(r.avisos.join(" ")).toMatch(/se suelta del pack/);
    expect(r.avisos.join(" ")).toMatch(/2 accesorios se quedan/);
  });
});
