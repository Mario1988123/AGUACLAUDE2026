import { describe, expect, it } from "vitest";
import { puedeAgendarPrueba } from "./permisos";

const s = (roles: string[], is_superadmin = false) => ({ roles, is_superadmin });

describe("quién agenda la prueba y asigna instalador", () => {
  it("el admin y el director técnico sí", () => {
    expect(puedeAgendarPrueba(s(["company_admin"]))).toBe(true);
    expect(puedeAgendarPrueba(s(["technical_director"]))).toBe(true);
    expect(puedeAgendarPrueba(s([], true))).toBe(true);
  });

  it("el comercial, el director comercial y el técnico no", () => {
    expect(puedeAgendarPrueba(s(["sales_rep"]))).toBe(false);
    expect(puedeAgendarPrueba(s(["commercial_director"]))).toBe(false);
    expect(puedeAgendarPrueba(s(["telemarketer"]))).toBe(false);
    expect(puedeAgendarPrueba(s(["installer"]))).toBe(false);
  });
});
