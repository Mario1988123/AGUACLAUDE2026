import { describe, expect, it } from "vitest";
import {
  decidirAnonimizar,
  diasRetencion,
  limiteRetencion,
  limiteWebhook,
  lotesPorEmpresa,
  RESUMEN_RETENCION_VACIO,
  sumarAnonimizado,
  type CandidatoRetencion,
} from "./retencion-logica";

const ahora = new Date("2026-11-27T03:00:00Z");
const viejo = "2025-10-01T00:00:00Z"; // más de 365 días antes
const base: CandidatoRetencion = {
  id: "p1",
  company_id: "e1",
  etapa: "sin_respuesta",
  lead_id: null,
  anonimizado_at: null,
  ultimo_movimiento: viejo,
  retencion_dias: 365,
};

describe("diasRetencion", () => {
  it("acota como el CHECK y pone 365 si falta", () => {
    expect(diasRetencion(null)).toBe(365);
    expect(diasRetencion(undefined)).toBe(365);
    expect(diasRetencion(Number.NaN)).toBe(365);
    expect(diasRetencion(5)).toBe(30);
    expect(diasRetencion(99999)).toBe(3650);
    expect(diasRetencion(90.7)).toBe(90);
  });
  it("límites de fecha", () => {
    expect(limiteRetencion(ahora, 30).toISOString()).toBe("2026-10-28T03:00:00.000Z");
    expect(limiteWebhook(ahora).toISOString()).toBe("2026-10-28T03:00:00.000Z");
  });
});

describe("decidirAnonimizar", () => {
  it("anonimiza al que nunca fue lead y lleva el plazo sin movimiento", () => {
    expect(decidirAnonimizar(base, ahora)).toEqual({ anonimizar: true });
    for (const etapa of ["nuevo", "revisar", "en_cola", "contactado", "recordado", "conversando", "descartado", "fallido"]) {
      expect(decidirAnonimizar({ ...base, etapa }, ahora).anonimizar).toBe(true);
    }
  });
  it("nunca toca a quien es lead o mostró interés", () => {
    expect(decidirAnonimizar({ ...base, lead_id: "l1" }, ahora)).toMatchObject({ anonimizar: false });
    for (const etapa of ["interesado", "caliente", "convertido"]) {
      expect(decidirAnonimizar({ ...base, etapa }, ahora)).toMatchObject({ anonimizar: false });
    }
  });
  it("respeta el plazo de la empresa", () => {
    expect(decidirAnonimizar({ ...base, ultimo_movimiento: "2026-06-01T00:00:00Z" }, ahora).anonimizar).toBe(false);
    // Con 90 días, lo de junio sí está fuera.
    expect(decidirAnonimizar({ ...base, retencion_dias: 90, ultimo_movimiento: "2026-06-01T00:00:00Z" }, ahora).anonimizar).toBe(true);
    // Justo en el límite todavía no.
    expect(decidirAnonimizar({ ...base, retencion_dias: 30, ultimo_movimiento: "2026-10-28T03:00:00Z" }, ahora).anonimizar).toBe(false);
  });
  it("sin fecha o ya anonimizado: no", () => {
    expect(decidirAnonimizar({ ...base, ultimo_movimiento: null }, ahora).anonimizar).toBe(false);
    expect(decidirAnonimizar({ ...base, ultimo_movimiento: "basura" }, ahora).anonimizar).toBe(false);
    expect(decidirAnonimizar({ ...base, anonimizado_at: "2026-01-01T00:00:00Z" }, ahora).anonimizar).toBe(false);
  });
});

describe("lotesPorEmpresa", () => {
  it("agrupa por empresa, trocea y descarta los que no tocan", () => {
    const c = [
      { ...base, id: "a" },
      { ...base, id: "b" },
      { ...base, id: "c", company_id: "e2" },
      { ...base, id: "d", lead_id: "l" },
      { ...base, id: "e" },
    ];
    expect(lotesPorEmpresa(c, ahora, 2)).toEqual([
      { companyId: "e1", ids: ["a", "b"] },
      { companyId: "e1", ids: ["e"] },
      { companyId: "e2", ids: ["c"] },
    ]);
    expect(lotesPorEmpresa([], ahora)).toEqual([]);
  });
});

describe("sumarAnonimizado", () => {
  it("suma lo que devuelve la base, aunque venga como texto", () => {
    const r = sumarAnonimizado(RESUMEN_RETENCION_VACIO, {
      prospectos: "2",
      conversaciones: 1,
      mensajes: 7,
      visitas: 0,
      propuestas: 1,
      envios_cancelados: 1,
    });
    expect(r).toMatchObject({ prospectos: 2, conversaciones: 1, mensajes: 7, propuestas: 1, enviosCancelados: 1 });
    expect(sumarAnonimizado(r, null).prospectos).toBe(2);
  });
});
