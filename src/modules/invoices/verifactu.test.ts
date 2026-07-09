import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { computeVerifactuHash, buildVerifactuQrUrl, type VerifactuRecordInput } from "./verifactu";

const base: VerifactuRecordInput = {
  issuer_nif: "B12345678",
  series_code: "A",
  invoice_number: 1,
  invoice_type: "F1",
  issued_at: new Date("2026-02-03T10:15:30.000Z"),
  operation_date: new Date("2026-02-03T10:15:30.000Z"),
  total_cents: 12100, // 121,00 €
  tax_cents: 2100, // 21,00 € de cuota IVA
  prev_hash: "",
  record_type: "alta",
};

// Reconstruye el concat EXACTO según la spec AEAT (mismos getters de fecha que el
// source => independiente de la zona horaria). Si el source cambiara el orden de
// campos, los separadores, el join serie-número o el formato de importe, este
// golden test fallaría (la huella cambia el cotejo legal en AEAT).
function expectedHash(i: VerifactuRecordInput): string {
  const dd = String(i.issued_at.getDate()).padStart(2, "0");
  const mm = String(i.issued_at.getMonth() + 1).padStart(2, "0");
  const fechaExp = `${dd}-${mm}-${i.issued_at.getFullYear()}`;
  const totalEur = (i.total_cents / 100).toFixed(2);
  const taxEur = ((i.tax_cents ?? i.total_cents) / 100).toFixed(2);
  const concat =
    `IDEmisorFactura=${i.issuer_nif}` +
    `&NumSerieFactura=${i.series_code}-${i.invoice_number}` +
    `&FechaExpedicionFactura=${fechaExp}` +
    `&TipoFactura=${i.invoice_type}` +
    `&CuotaTotal=${taxEur}` +
    `&ImporteTotal=${totalEur}` +
    `&Huella=${i.prev_hash || ""}` +
    `&FechaHoraHusoGenRegistro=${i.issued_at.toISOString()}` +
    `&`;
  return crypto.createHash("sha256").update(concat, "utf8").digest("hex").toUpperCase();
}

describe("computeVerifactuHash", () => {
  it("coincide con el SHA-256 del concat en formato AEAT (golden)", () => {
    expect(computeVerifactuHash(base)).toBe(expectedHash(base));
  });

  it("es hex en mayúsculas de 64 caracteres", () => {
    expect(computeVerifactuHash(base)).toMatch(/^[0-9A-F]{64}$/);
  });

  it("es determinista", () => {
    expect(computeVerifactuHash(base)).toBe(computeVerifactuHash({ ...base }));
  });

  it("encadena: cambiar prev_hash cambia la huella", () => {
    const h1 = computeVerifactuHash(base);
    const h2 = computeVerifactuHash({ ...base, prev_hash: h1 });
    expect(h2).not.toBe(h1);
    expect(h2).toBe(expectedHash({ ...base, prev_hash: h1 }));
  });

  it("CuotaTotal cae a ImporteTotal si no se pasa tax_cents (compat)", () => {
    const noTax: VerifactuRecordInput = {
      issuer_nif: "B12345678",
      series_code: "A",
      invoice_number: 1,
      invoice_type: "F1",
      issued_at: base.issued_at,
      operation_date: base.operation_date,
      total_cents: 12100,
      prev_hash: "",
      record_type: "alta",
    };
    expect(computeVerifactuHash(noTax)).toBe(expectedHash(noTax));
    // y difiere del que sí lleva una cuota distinta al total
    expect(computeVerifactuHash(noTax)).not.toBe(computeVerifactuHash(base));
  });
});

describe("buildVerifactuQrUrl", () => {
  it("incluye nif, numserie (serie/numero), importe y host oficial", () => {
    const url = buildVerifactuQrUrl({
      issuer_nif: "B12345678",
      series_code: "A",
      invoice_number: 7,
      issued_at: new Date("2026-02-03T10:00:00Z"),
      total_cents: 12100,
    });
    expect(url).toContain("nif=B12345678");
    expect(url).toContain("numserie=A%2F7"); // "A/7" url-encoded
    expect(url).toContain("importe=121.00");
    expect(url).toContain("agenciatributaria.gob.es");
  });

  it("modo test usa el host de preproducción", () => {
    const url = buildVerifactuQrUrl({
      issuer_nif: "X",
      series_code: "A",
      invoice_number: 1,
      issued_at: new Date("2026-02-03T10:00:00Z"),
      total_cents: 100,
      test: true,
    });
    expect(url).toContain("prewww2.aeat.es");
  });
});
