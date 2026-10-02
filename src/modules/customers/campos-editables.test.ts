import { describe, expect, it } from "vitest";
import {
  CAMPOS_EDITABLES_CLIENTE,
  CAMPOS_EDITABLES_LEAD,
  elegirCampos,
} from "./campos-editables";
import { enmascararIban } from "./rgpd-anonimizar";

describe("elegirCampos", () => {
  it("deja pasar solo columnas de la lista blanca del cliente", () => {
    const r = elegirCampos(
      {
        email: "a@b.es",
        notes: null,
        company_id: "otra",
        assigned_user_id: "yo",
        deleted_at: "2026-01-01",
        status: "x",
        id: "y",
        created_by: "z",
      },
      CAMPOS_EDITABLES_CLIENTE,
    );
    expect(r).toEqual({ email: "a@b.es", notes: null });
  });
  it("en leads no deja tocar status ni asignación", () => {
    const r = elegirCampos(
      { potential: "A", status: "won", assigned_user_id: "u", converted_at: "x" },
      CAMPOS_EDITABLES_LEAD,
    );
    expect(r).toEqual({ potential: "A" });
  });
  it("ignora claves del prototipo y entradas que no son objeto", () => {
    const proto = Object.create({ email: "heredado@x.es" });
    expect(elegirCampos(proto, CAMPOS_EDITABLES_CLIENTE)).toEqual({});
    expect(elegirCampos(null, CAMPOS_EDITABLES_CLIENTE)).toEqual({});
    expect(elegirCampos(["email"], CAMPOS_EDITABLES_CLIENTE)).toEqual({});
    expect(elegirCampos("email", CAMPOS_EDITABLES_CLIENTE)).toEqual({});
  });
  it("ninguna lista incluye columnas sensibles", () => {
    const prohibidas = ["id", "company_id", "created_by", "assigned_user_id", "status", "deleted_at"];
    for (const c of prohibidas) {
      expect(CAMPOS_EDITABLES_CLIENTE as readonly string[]).not.toContain(c);
      expect(CAMPOS_EDITABLES_LEAD as readonly string[]).not.toContain(c);
    }
  });
});

describe("enmascararIban (RGPD)", () => {
  it("conserva prefijo y 4 últimos y quita espacios", () => {
    expect(enmascararIban("ES91 2100 0418 4502 0005 1332")).toBe(
      "ES91" + "*".repeat(16) + "1332",
    );
  });
  it("IBAN demasiado corto → todo enmascarado", () => {
    expect(enmascararIban("ES12345")).toBe("****");
  });
});
