import { describe, it, expect } from "vitest";
import {
  agruparDesglose,
  centimosAImporte,
  claveIdempotencia,
  construirCuerpoAlta,
  construirCuerpoAnulacion,
  fechaVerifacti,
  mensajeErrorVerifacti,
  normalizarNif,
  separarSerieNumero,
  type FacturaCrmParaVerifacti,
} from "./verifacti-mapeo";

const HOY = "2026-10-03";

function factura(p: Partial<FacturaCrmParaVerifacti> = {}): FacturaCrmParaVerifacti {
  return {
    kind: "invoice",
    full_reference: "F-2026-00012",
    issue_date: HOY,
    is_simplified: false,
    description: null,
    notes: null,
    subtotal_cents: 20000,
    tax_cents: 4200,
    cliente: { nombre: "Aguas del Norte SL", nif: "B12345678", pais: "ES" },
    lineas: [
      { description: "Ósmosis", subtotal_cents: 15000, tax_cents: 3150, tax_rate_percent: 21 },
      { description: "Instalación", subtotal_cents: 5000, tax_cents: 1050, tax_rate_percent: 21 },
    ],
    ...p,
  };
}

describe("formatos", () => {
  it("céntimos a euros sin coma flotante, con signo", () => {
    expect(centimosAImporte(24200)).toBe("242.00");
    expect(centimosAImporte(5)).toBe("0.05");
    expect(centimosAImporte(-60500)).toBe("-605.00");
    expect(centimosAImporte(0)).toBe("0.00");
    expect(centimosAImporte(1999)).toBe("19.99");
    expect(() => centimosAImporte(1.5)).toThrow();
  });

  it("fecha AAAA-MM-DD a DD-MM-AAAA", () => {
    expect(fechaVerifacti("2026-10-03")).toBe("03-10-2026");
    expect(fechaVerifacti("2026-01-09T22:00:00Z")).toBe("09-01-2026");
  });

  it("serie conserva el guion para que serie+número = referencia impresa", () => {
    expect(separarSerieNumero("F-2026-00012")).toEqual({ serie: "F-2026-", numero: "00012" });
    const { serie, numero } = separarSerieNumero("R-2026-00001");
    expect(serie + numero).toBe("R-2026-00001");
    expect(separarSerieNumero("123")).toEqual({ serie: "", numero: "123" });
  });

  it("normaliza NIF", () => {
    expect(normalizarNif(" b-12.345.678 ")).toBe("B12345678");
    expect(normalizarNif("ESB12345678")).toBe("B12345678");
    expect(normalizarNif("")).toBeNull();
  });
});

describe("desglose por tipo de IVA", () => {
  it("agrupa líneas del mismo tipo en una sola", () => {
    const r = agruparDesglose(factura().lineas);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.grupos).toHaveLength(1);
      expect(r.grupos[0]).toMatchObject({ base: 20000, cuota: 4200, tipo: "21" });
    }
  });

  it("separa tipos distintos y rechaza tipos que no admite la AEAT", () => {
    const r = agruparDesglose([
      { description: "a", subtotal_cents: 1000, tax_cents: 210, tax_rate_percent: 21 },
      { description: "b", subtotal_cents: 1000, tax_cents: 100, tax_rate_percent: 10 },
    ]);
    expect(r.ok && r.grupos.length).toBe(2);
    const mal = agruparDesglose([
      { description: "c", subtotal_cents: 1000, tax_cents: 160, tax_rate_percent: 16 },
    ]);
    expect(mal.ok).toBe(false);
  });

  it("exenta exige causa E1–E6", () => {
    expect(
      agruparDesglose([
        { description: "x", subtotal_cents: 1000, tax_cents: 0, tax_rate_percent: 0, is_exempt: true },
      ]).ok,
    ).toBe(false);
    const ok = agruparDesglose([
      { description: "x", subtotal_cents: 1000, tax_cents: 0, tax_rate_percent: 0, is_exempt: true, exempt_reason: "e1" },
    ]);
    expect(ok.ok && ok.grupos[0]?.exenta).toBe("E1");
  });
});

describe("cuerpo de alta (POST /verifactu/create)", () => {
  it("factura ordinaria F1 con importes en euros y fecha de hoy", () => {
    const r = construirCuerpoAlta(factura(), HOY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo).toEqual({
      serie: "F-2026-",
      numero: "00012",
      fecha_expedicion: "03-10-2026",
      tipo_factura: "F1",
      descripcion: "Ósmosis; Instalación",
      lineas: [{ base_imponible: "200.00", tipo_impositivo: "21", cuota_repercutida: "42.00" }],
      importe_total: "242.00",
      nif: "B12345678",
      nombre: "Aguas del Norte SL",
    });
  });

  it("varios tipos de IVA: una línea por tipo y total = suma", () => {
    const r = construirCuerpoAlta(
      factura({
        subtotal_cents: 30000,
        tax_cents: 5200,
        lineas: [
          { description: "a", subtotal_cents: 20000, tax_cents: 4200, tax_rate_percent: 21 },
          { description: "b", subtotal_cents: 10000, tax_cents: 1000, tax_rate_percent: 10 },
        ],
      }),
      HOY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo.lineas).toEqual([
      { base_imponible: "200.00", tipo_impositivo: "21", cuota_repercutida: "42.00" },
      { base_imponible: "100.00", tipo_impositivo: "10", cuota_repercutida: "10.00" },
    ]);
    expect(r.cuerpo.importe_total).toBe("352.00");
  });

  it("no envía si la fecha de expedición no es hoy", () => {
    const r = construirCuerpoAlta(factura({ issue_date: "2026-10-01" }), HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fecha de hoy/);
  });

  it("no envía si las líneas no cuadran con los totales", () => {
    const r = construirCuerpoAlta(factura({ tax_cents: 4201 }), HOY);
    expect(r.ok).toBe(false);
  });

  it("exige NIF en factura completa y lo valida", () => {
    expect(construirCuerpoAlta(factura({ cliente: { nombre: "Ana", nif: null, pais: "ES" } }), HOY).ok).toBe(false);
    expect(construirCuerpoAlta(factura({ cliente: { nombre: "Ana", nif: "123", pais: "ES" } }), HOY).ok).toBe(false);
  });

  it("simplificada: F2 sin destinatario", () => {
    const r = construirCuerpoAlta(
      factura({ is_simplified: true, cliente: { nombre: "", nif: null, pais: "ES" } }),
      HOY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo.tipo_factura).toBe("F2");
    expect(r.cuerpo.nif).toBeUndefined();
    expect(r.cuerpo.nombre).toBeUndefined();
  });

  it("cliente intracomunitario va por id_otro con NIF-IVA (02)", () => {
    const r = construirCuerpoAlta(
      factura({ cliente: { nombre: "Wasser GmbH", nif: "DE123456789", pais: "DE" } }),
      HOY,
    );
    expect(r.ok && r.cuerpo.id_otro).toEqual({ codigo_pais: "DE", id_type: "02", id: "DE123456789" });
    expect(r.ok && r.cuerpo.nif).toBeUndefined();
  });

  it("inversión del sujeto pasivo: S2 sin cuota", () => {
    const r = construirCuerpoAlta(
      factura({
        tax_cents: 0,
        lineas: [
          { description: "obra", subtotal_cents: 20000, tax_cents: 0, tax_rate_percent: 21, is_reverse_charge: true },
        ],
      }),
      HOY,
    );
    expect(r.ok && r.cuerpo.lineas[0]).toEqual({
      base_imponible: "200.00",
      tipo_impositivo: "21",
      cuota_repercutida: "0.00",
      calificacion_operacion: "S2",
    });
  });

  it("rectificativa por diferencias (como la genera createCreditNoteAction): R1 + I, negativos y referencia a la original", () => {
    const r = construirCuerpoAlta(
      factura({
        kind: "credit_note",
        full_reference: "R-2026-00001",
        notes: "Rectificativa de F-2026-00012",
        subtotal_cents: -20000,
        tax_cents: -4200,
        lineas: [
          { description: "Ósmosis", subtotal_cents: -15000, tax_cents: -3150, tax_rate_percent: 21 },
          { description: "Instalación", subtotal_cents: -5000, tax_cents: -1050, tax_rate_percent: 21 },
        ],
        rectificada: { full_reference: "F-2026-00012", issue_date: "2026-09-15" },
      }),
      HOY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo).toMatchObject({
      serie: "R-2026-",
      numero: "00001",
      tipo_factura: "R1",
      tipo_rectificativa: "I",
      lineas: [{ base_imponible: "-200.00", tipo_impositivo: "21", cuota_repercutida: "-42.00" }],
      importe_total: "-242.00",
      facturas_rectificadas: [{ serie: "F-2026-", numero: "00012", fecha_expedicion: "15-09-2026" }],
      descripcion: "Rectificación por diferencias de la factura F-2026-00012",
    });
    expect("importe_rectificativa" in r.cuerpo).toBe(false);
  });

  it("rectificativa con total positivo o factura con total negativo: no se envían", () => {
    expect(construirCuerpoAlta(factura({ kind: "credit_note" }), HOY).ok).toBe(false);
    expect(
      construirCuerpoAlta(
        factura({
          subtotal_cents: -100,
          tax_cents: -21,
          lineas: [{ description: "x", subtotal_cents: -100, tax_cents: -21, tax_rate_percent: 21 }],
        }),
        HOY,
      ).ok,
    ).toBe(false);
  });

  it("más de 12 tratamientos de IVA: error", () => {
    const lineas = ["0", "2", "4", "5", "7.5", "10", "21"].flatMap((t) => [
      { description: t, subtotal_cents: 100, tax_cents: 0, tax_rate_percent: Number(t), is_reverse_charge: true },
      { description: t, subtotal_cents: 100, tax_cents: Math.round(Number(t)), tax_rate_percent: Number(t) },
    ]);
    const sub = lineas.reduce((s, l) => s + l.subtotal_cents, 0);
    const tax = lineas.reduce((s, l) => s + l.tax_cents, 0);
    const r = construirCuerpoAlta(factura({ lineas, subtotal_cents: sub, tax_cents: tax }), HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/12/);
  });
});

describe("anulación e idempotencia", () => {
  it("cuerpo de anulación con serie, número y fecha original", () => {
    expect(construirCuerpoAnulacion({ full_reference: "F-2026-00012", issue_date: "2026-09-15" })).toEqual({
      serie: "F-2026-",
      numero: "00012",
      fecha_expedicion: "15-09-2026",
    });
  });

  it("misma factura y mismo cuerpo → misma clave; cuerpo distinto → clave distinta", () => {
    const a = construirCuerpoAlta(factura(), HOY);
    const b = construirCuerpoAlta(factura({ cliente: { nombre: "Otra SL", nif: "B12345678", pais: "ES" } }), HOY);
    if (!a.ok || !b.ok) throw new Error("mapeo");
    const k1 = claveIdempotencia("alta", "inv-1", a.cuerpo);
    expect(claveIdempotencia("alta", "inv-1", a.cuerpo)).toBe(k1);
    expect(claveIdempotencia("alta", "inv-1", b.cuerpo)).not.toBe(k1);
    expect(claveIdempotencia("anulacion", "inv-1", a.cuerpo)).not.toBe(k1);
    expect(k1).toMatch(/^[\x20-\x7E]{1,255}$/);
  });

  it("errores de Verifacti en español", () => {
    expect(mensajeErrorVerifacti(401, null)).toMatch(/API key/);
    expect(mensajeErrorVerifacti(400, { error: "Faltan campos requeridos.", codigo: "vf-verifactu-campos_requeridos" })).toMatch(
      /Faltan campos requeridos.*vf-verifactu-campos_requeridos/,
    );
    expect(mensajeErrorVerifacti(400, { codigo: "vf-verifactu-factura_duplicada" })).toMatch(/ya está registrada/);
    expect(mensajeErrorVerifacti(409, null)).toMatch(/procesando/);
    expect(mensajeErrorVerifacti(503, null)).toMatch(/no registró/);
  });
});
