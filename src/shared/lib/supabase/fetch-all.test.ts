import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllRows, POSTGREST_MAX_ROWS } from "./fetch-all";

/** Simula PostgREST: sirve `.range(from,to)` sobre un dataset, cortando
 *  siempre a max-rows aunque le pidas un rango mayor. */
function fakeTable(total: number, maxRows = POSTGREST_MAX_ROWS) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  return (from: number, to: number) => {
    const size = Math.min(to - from + 1, maxRows);
    return Promise.resolve({ data: rows.slice(from, from + size), error: null });
  };
}

afterEach(() => vi.restoreAllMocks());

describe("fetchAllRows", () => {
  it("trae más de 1000 filas, que era justo lo que el .limit() no conseguía", async () => {
    const rows = await fetchAllRows<{ id: number }>(fakeTable(2350));
    expect(rows).toHaveLength(2350);
    expect(rows[0]!.id).toBe(0);
    expect(rows[2349]!.id).toBe(2349);
  });

  it("no repite ni se salta filas entre tramos", async () => {
    const rows = await fetchAllRows<{ id: number }>(fakeTable(2001));
    expect(new Set(rows.map((r) => r.id)).size).toBe(2001);
  });

  it("una sola petición si cabe en un tramo", async () => {
    const page = vi.fn(fakeTable(10));
    const rows = await fetchAllRows<{ id: number }>(page);
    expect(rows).toHaveLength(10);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("dataset vacío devuelve [] sin bucle infinito", async () => {
    const page = vi.fn(fakeTable(0));
    expect(await fetchAllRows(page)).toEqual([]);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("el múltiplo exacto de pageSize cierra con un tramo vacío", async () => {
    const page = vi.fn(fakeTable(2000));
    const rows = await fetchAllRows<{ id: number }>(page);
    expect(rows).toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(3); // 1000 + 1000 + vacío
  });

  it("ante error devuelve lo acumulado y DEJA RASTRO (el fallo era el silencio)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    const rows = await fetchAllRows<{ id: number }>((from, to) => {
      call += 1;
      if (call === 2) return Promise.resolve({ data: null, error: { message: "boom" } });
      return fakeTable(5000)(from, to);
    });
    expect(rows).toHaveLength(1000);
    expect(spy).toHaveBeenCalled();
  });

  it("respeta el tope de seguridad y avisa", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await fetchAllRows<{ id: number }>(fakeTable(10000), { maxRows: 2000 });
    expect(rows).toHaveLength(2000);
    expect(spy).toHaveBeenCalled();
  });

  it("recorta pageSize a max-rows: pedir 5000 no sirve de nada", async () => {
    const seen: Array<[number, number]> = [];
    await fetchAllRows<{ id: number }>((from, to) => {
      seen.push([from, to]);
      return fakeTable(1500)(from, to);
    }, { pageSize: 5000 });
    expect(seen[0]).toEqual([0, POSTGREST_MAX_ROWS - 1]);
  });
});
