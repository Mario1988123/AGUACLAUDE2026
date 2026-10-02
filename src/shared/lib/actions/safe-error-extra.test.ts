import { describe, it, expect, vi, afterEach } from "vitest";
import { errorMessage, runSafe } from "./safe-error";

afterEach(() => vi.restoreAllMocks());

describe("errorMessage", () => {
  it("un PostgrestError (objeto plano) no sale como [object Object]", () => {
    const pgErr = {
      message: 'Could not find the function public.voice_purge_transcripts',
      details: null,
      hint: "Perhaps you meant app.voice_purge_transcripts",
      code: "PGRST202",
    };
    const m = errorMessage(pgErr);
    expect(m).not.toContain("[object Object]");
    expect(m).toContain("voice_purge_transcripts");
    expect(m).toContain("PGRST202");
  });
  it("Error y string tal cual", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("texto")).toBe("texto");
  });
  it("objeto sin message: JSON", () => {
    expect(errorMessage({ a: 1 })).toBe('{"a":1}');
  });
  it("no relanza un redirect (es para logs)", () => {
    const r = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/x;307;" });
    expect(() => errorMessage(r)).not.toThrow();
  });
});

describe("runSafe", () => {
  it("devuelve ok con el dato", async () => {
    await expect(runSafe(async () => 42)).resolves.toEqual({ ok: true, data: 42 });
  });
  it("convierte la excepción en {ok:false,error} con el mensaje amable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runSafe(async () => {
      throw new Error("Producto · dim_width_mm: El ancho debe ser mayor que 0");
    });
    expect(r).toEqual({ ok: false, error: "Producto · dim_width_mm: El ancho debe ser mayor que 0" });
  });
  it("deja pasar el redirect de Next", async () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/productos/1;307;",
    });
    await expect(
      runSafe(async () => {
        throw redirectErr;
      }),
    ).rejects.toBe(redirectErr);
  });
});
