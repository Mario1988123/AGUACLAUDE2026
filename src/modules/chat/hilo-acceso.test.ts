import { describe, expect, it } from "vitest";
import { filtroRealtimeHilos, MAX_HILOS_FILTRO_REALTIME, puedeLeerHilo } from "./hilo-acceso";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("puedeLeerHilo", () => {
  it("niega sin hilo o sin empresa en la sesión", () => {
    expect(puedeLeerHilo(null, A, true)).toBe(false);
    expect(puedeLeerHilo({ kind: "broadcast", company_id: A }, null, true)).toBe(false);
  });
  it("niega hilos de otra empresa aunque sea miembro o broadcast", () => {
    expect(puedeLeerHilo({ kind: "broadcast", company_id: B }, A, true)).toBe(false);
    expect(puedeLeerHilo({ kind: "direct", company_id: B }, A, true)).toBe(false);
  });
  it("broadcast de mi empresa: siempre", () => {
    expect(puedeLeerHilo({ kind: "broadcast", company_id: A }, A, false)).toBe(true);
  });
  it("team/direct de mi empresa: solo si soy miembro", () => {
    expect(puedeLeerHilo({ kind: "team", company_id: A }, A, false)).toBe(false);
    expect(puedeLeerHilo({ kind: "direct", company_id: A }, A, false)).toBe(false);
    expect(puedeLeerHilo({ kind: "team", company_id: A }, A, true)).toBe(true);
  });
});

describe("filtroRealtimeHilos", () => {
  it("null si no hay hilos", () => {
    expect(filtroRealtimeHilos([])).toBeNull();
  });
  it("descarta ids que no son UUID y duplicados", () => {
    expect(filtroRealtimeHilos([A, A, "x),(y", B])).toBe(`thread_id=in.(${A},${B})`);
    expect(filtroRealtimeHilos(["no-uuid"])).toBeNull();
  });
  it("limita al máximo que admite Realtime", () => {
    const ids = Array.from(
      { length: 150 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    const f = filtroRealtimeHilos(ids)!;
    expect(f.split(",").length).toBe(MAX_HILOS_FILTRO_REALTIME);
  });
});
