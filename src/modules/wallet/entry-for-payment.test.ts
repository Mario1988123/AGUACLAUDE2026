import { describe, it, expect, vi } from "vitest";
import { findLiveWalletEntryForPayment } from "./entry-for-payment";

/**
 * Mock fluido del query builder de supabase-js: cada método encadena y
 * maybeSingle() resuelve lo que diga el test. Capturamos los filtros para
 * comprobar que la guarda consulta lo correcto (empresa + pago + no-rejected).
 */
function makeClient(result: { data: unknown; error: unknown } | Error) {
  const calls: Array<[string, unknown, unknown?]> = [];
  const qb = {
    select: (...a: unknown[]) => (calls.push(["select", a[0]]), qb),
    eq: (col: unknown, val: unknown) => (calls.push(["eq", col, val]), qb),
    neq: (col: unknown, val: unknown) => (calls.push(["neq", col, val]), qb),
    order: (...a: unknown[]) => (calls.push(["order", a[0]]), qb),
    limit: (n: unknown) => (calls.push(["limit", n]), qb),
    maybeSingle: () =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  };
  const from = vi.fn(() => qb);
  return { client: { from }, from, calls };
}

describe("findLiveWalletEntryForPayment (guarda doble cobro)", () => {
  it("devuelve el id de la entry viva existente para el pago", async () => {
    const { client, from, calls } = makeClient({ data: { id: "we-1" }, error: null });
    const id = await findLiveWalletEntryForPayment(client, "co-1", "cp-1");
    expect(id).toBe("we-1");
    expect(from).toHaveBeenCalledWith("wallet_entries");
    expect(calls).toContainEqual(["eq", "company_id", "co-1"]);
    expect(calls).toContainEqual(["eq", "contract_payment_id", "cp-1"]);
    // Un re-cobro tras rechazo es legítimo: las rejected no cuentan como vivas.
    expect(calls).toContainEqual(["neq", "status", "rejected"]);
  });

  it("devuelve null si no hay entry para el pago (camino normal: insertar)", async () => {
    const { client } = makeClient({ data: null, error: null });
    expect(await findLiveWalletEntryForPayment(client, "co-1", "cp-1")).toBeNull();
  });

  it("fail-open: devuelve null si la consulta da error (no bloquea el cobro)", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    expect(await findLiveWalletEntryForPayment(client, "co-1", "cp-1")).toBeNull();
  });

  it("fail-open: devuelve null si la consulta lanza excepción", async () => {
    const { client } = makeClient(new Error("network down"));
    expect(await findLiveWalletEntryForPayment(client, "co-1", "cp-1")).toBeNull();
  });
});
