import { describe, it, expect } from "vitest";
import { claveIdempotenciaCobro, transicionPagoGcPermitida } from "./estados";

describe("I24 · máquina de estados de un pago GoCardless", () => {
  it("avanza por el camino feliz", () => {
    expect(transicionPagoGcPermitida("pending_submission", "submitted")).toBe(true);
    expect(transicionPagoGcPermitida("submitted", "confirmed")).toBe(true);
    expect(transicionPagoGcPermitida("confirmed", "paid_out")).toBe(true);
    // Puede saltarse pasos si un evento se pierde
    expect(transicionPagoGcPermitida("pending_submission", "paid_out")).toBe(true);
  });

  it("un evento tardío NO hace retroceder (confirmed después de paid_out)", () => {
    expect(transicionPagoGcPermitida("paid_out", "confirmed")).toBe(false);
    expect(transicionPagoGcPermitida("confirmed", "submitted")).toBe(false);
    expect(transicionPagoGcPermitida("confirmed", "confirmed")).toBe(false);
  });

  it("negativos solo desde donde tienen sentido", () => {
    expect(transicionPagoGcPermitida("submitted", "failed")).toBe(true);
    expect(transicionPagoGcPermitida("paid_out", "failed")).toBe(false);
    expect(transicionPagoGcPermitida("paid_out", "charged_back")).toBe(true);
    expect(transicionPagoGcPermitida("submitted", "charged_back")).toBe(false);
    expect(transicionPagoGcPermitida("confirmed", "cancelled")).toBe(false);
  });

  it("estados finales; un fallido solo vuelve a 'submitted' (reenvío)", () => {
    expect(transicionPagoGcPermitida("charged_back", "paid_out")).toBe(false);
    expect(transicionPagoGcPermitida("cancelled", "submitted")).toBe(false);
    expect(transicionPagoGcPermitida("failed", "submitted")).toBe(true);
    expect(transicionPagoGcPermitida("failed", "paid_out")).toBe(false);
  });
});

describe("I24 · clave de idempotencia determinista", () => {
  const base = { companyId: "c1", mandateId: "MD1", importeCents: 9900 };
  it("mismo cobro → misma clave (un doble clic no crea dos cargos)", () => {
    expect(claveIdempotenciaCobro({ ...base, contractPaymentId: "cp1" })).toBe(
      claveIdempotenciaCobro({ ...base, contractPaymentId: "cp1" }),
    );
  });
  it("otro intento, otro importe u otro cobro → otra clave", () => {
    const k = claveIdempotenciaCobro({ ...base, contractPaymentId: "cp1" });
    expect(claveIdempotenciaCobro({ ...base, contractPaymentId: "cp1", intento: 1 })).not.toBe(k);
    expect(claveIdempotenciaCobro({ ...base, contractPaymentId: "cp1", importeCents: 9901 })).not.toBe(k);
    expect(claveIdempotenciaCobro({ ...base, contractPaymentId: "cp2" })).not.toBe(k);
    expect(claveIdempotenciaCobro({ ...base, invoiceId: "inv1" })).not.toBe(k);
  });
  it("cobro suelto (sin factura ni pago de contrato) → null", () => {
    expect(claveIdempotenciaCobro(base)).toBeNull();
  });
});
