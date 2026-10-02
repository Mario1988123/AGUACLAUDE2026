import { describe, it, expect } from "vitest";
import { isPublicPath } from "./public-paths";

describe("isPublicPath (auditoría 2026-10-01 I19)", () => {
  it("abre los enlaces que la empresa manda al cliente", () => {
    for (const p of [
      "/catalogo/abc123abc123abc123",
      "/datasheet/abc123abc123abc123",
      "/datasheet/abc123abc123abc123/pdf",
      "/api/pdf/catalog-v2/abc123abc123abc123",
      "/api/pdf/contract/public/abc123abc123abc123abc123abc123ab",
      "/firmar-contrato/tok",
      "/i/tok",
      "/m/tok",
      "/baja",
    ]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it("NO abre las rutas privadas vecinas", () => {
    for (const p of [
      "/",
      "/productos",
      "/superadmin/catalogo",
      "/api/pdf/contract/123e4567-e89b-12d3-a456-426614174000",
      "/api/pdf/product-datasheet/123e4567-e89b-12d3-a456-426614174000",
      "/api/pdf/catalog",
      "/api/pdf/invoice/1",
      "/api/export/customers",
      "/clientes/1",
      "/catalogo", // sin token no hay nada que ver
      "/datasheet",
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});
