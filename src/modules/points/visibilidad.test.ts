import { describe, expect, it } from "vitest";
import { esGestorComisiones } from "./visibilidad";

describe("esGestorComisiones (I16)", () => {
  it("admin, director comercial y superadmin ven toda la plantilla", () => {
    expect(esGestorComisiones({ is_superadmin: true, roles: [] })).toBe(true);
    expect(esGestorComisiones({ is_superadmin: false, roles: ["company_admin"] })).toBe(true);
    expect(esGestorComisiones({ is_superadmin: false, roles: ["commercial_director"] })).toBe(true);
  });
  it("el resto solo lo suyo", () => {
    for (const r of ["sales_rep", "telemarketer", "installer", "technical_director"]) {
      expect(esGestorComisiones({ is_superadmin: false, roles: [r] })).toBe(false);
    }
  });
});
