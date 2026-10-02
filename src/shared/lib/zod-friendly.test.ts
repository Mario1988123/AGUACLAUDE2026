import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zOptionalInt, zOptionalNumber, zIntDefault, validatePatch } from "./zod-friendly";

describe("zOptionalInt", () => {
  const s = zOptionalInt(1, "Mayor que 0");
  it('"" y espacios → null (no 0)', () => {
    expect(s.parse("")).toBeNull();
    expect(s.parse("  ")).toBeNull();
    expect(s.parse(undefined)).toBeNull();
  });
  it("mensajes en español", () => {
    expect(s.safeParse("0").error?.issues[0]?.message).toBe("Mayor que 0");
    expect(s.safeParse("1.5").error?.issues[0]?.message).toMatch(/entero/);
    expect(s.safeParse("abc").error?.issues[0]?.message).toMatch(/número/);
    expect(zOptionalInt().safeParse("-1").error?.issues[0]?.message).toBe("Tiene que ser 0 o más");
  });
});

describe("zOptionalNumber", () => {
  it("admite decimales y vacío = null", () => {
    expect(zOptionalNumber().parse("1.25")).toBe(1.25);
    expect(zOptionalNumber().parse("")).toBeNull();
  });
});

describe("zIntDefault", () => {
  it('"" → valor por defecto, no 0', () => {
    expect(zIntDefault(5, 1).parse("")).toBe(5);
    expect(zIntDefault(5, 1).parse(undefined)).toBe(5);
    expect(zIntDefault(5, 1).parse("7")).toBe(7);
  });
  it("dentro de un .partial(), la clave ausente sigue ausente", () => {
    const sch = z.object({ n: zIntDefault(5, 1) }).partial();
    expect(sch.parse({})).toEqual({});
  });
});

describe("validatePatch", () => {
  it("solo valida y normaliza las claves presentes", () => {
    const [p, err] = validatePatch({ a: "", b: "x" }, { a: zOptionalInt(1), c: zOptionalInt(1) });
    expect(err).toBeNull();
    expect(p).toEqual({ a: null, b: "x" });
  });
  it("devuelve el error con la etiqueta", () => {
    const [p, err] = validatePatch({ a: 0 }, { a: zOptionalInt(1, "mal") }, { a: "Ancho" });
    expect(p).toBeNull();
    expect(err).toBe("Ancho: mal");
  });
});
