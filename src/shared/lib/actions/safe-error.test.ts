import { describe, it, expect, vi, afterEach } from "vitest";
import { toActionError, isNextControlFlowError } from "./safe-error";

afterEach(() => vi.restoreAllMocks());

function silence() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("isNextControlFlowError", () => {
  it("reconoce redirect y notFound por digest", () => {
    expect(isNextControlFlowError({ digest: "NEXT_REDIRECT;push;/login;307;" })).toBe(true);
    expect(isNextControlFlowError({ digest: "NEXT_NOT_FOUND" })).toBe(true);
  });
  it("no confunde un error normal", () => {
    expect(isNextControlFlowError(new Error("boom"))).toBe(false);
    expect(isNextControlFlowError(null)).toBe(false);
    expect(isNextControlFlowError("NEXT_REDIRECT-ish")).toBe(false);
  });
});

describe("toActionError", () => {
  it("RELANZA el redirect en vez de convertirlo en toast (el bug de origen)", () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/login;307;",
    });
    expect(() => toActionError(redirectErr)).toThrow(redirectErr);
  });

  it("relanza notFound", () => {
    const nf = Object.assign(new Error("x"), { digest: "NEXT_NOT_FOUND" });
    expect(() => toActionError(nf)).toThrow(nf);
  });

  it("devuelve el mensaje de un Error normal", () => {
    silence();
    expect(toActionError(new Error("Este lead tiene propuestas."))).toBe(
      "Este lead tiene propuestas.",
    );
  });

  it("saca el message de un error de Supabase (objeto plano)", () => {
    silence();
    expect(toActionError({ message: "duplicate key value", code: "23505" })).toBe(
      "duplicate key value",
    );
  });

  it("cae a details/hint si no hay message", () => {
    silence();
    expect(toActionError({ message: "", details: "clave duplicada" })).toBe(
      "clave duplicada",
    );
  });

  it("acepta un string lanzado a pelo", () => {
    silence();
    expect(toActionError("algo raro")).toBe("algo raro");
  });

  it("ante lo desconocido da algo accionable, no la cadena \"Error\"", () => {
    silence();
    const msg = toActionError({ raro: true });
    expect(msg).not.toBe("Error");
    expect(msg.length).toBeGreaterThan(20);
  });

  it("deja rastro en el log del servidor", () => {
    const spy = silence();
    toActionError(new Error("boom"), "deleteLead");
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]![0])).toContain("deleteLead");
  });
});
