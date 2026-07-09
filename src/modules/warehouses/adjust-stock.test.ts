import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock del admin client: capturamos la llamada .rpc(...) sin tocar BD ni
// "server-only". La respuesta se controla por test con rpcImpl.
const rpc = vi.fn();
vi.mock("@/shared/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

import {
  adjustStockBatch,
  isInsufficientStockError,
  type StockAdjustment,
} from "./adjust-stock";

beforeEach(() => {
  rpc.mockReset();
});

describe("adjustStockBatch", () => {
  it("llama a la RPC adjust_stock_batch con company, performer y ajustes", async () => {
    rpc.mockResolvedValue({ data: [{ warehouse_id: "w", product_id: "p", requested: -2, applied: -2 }], error: null });
    const adjustments: StockAdjustment[] = [
      { warehouse_id: "w1", product_id: "p1", delta: -2, movement_type: "transfer_out", destination_warehouse_id: "w2" },
      { warehouse_id: "w2", product_id: "p1", delta: 2, movement_type: "transfer_in" },
    ];
    const res = await adjustStockBatch("co1", "user1", adjustments);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("adjust_stock_batch", {
      p_company_id: "co1",
      p_performed_by: "user1",
      p_adjustments: adjustments,
    });
    expect(res).toEqual([{ warehouse_id: "w", product_id: "p", requested: -2, applied: -2 }]);
  });

  it("devuelve [] si la RPC no trae data", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await adjustStockBatch("co1", null, [])).toEqual([]);
  });

  it("lanza el mensaje de error de la RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "INSUFFICIENT_STOCK: ..." } });
    await expect(adjustStockBatch("co1", "u", [])).rejects.toThrow(/INSUFFICIENT_STOCK/);
  });
});

describe("isInsufficientStockError", () => {
  it("reconoce el error de stock insuficiente", () => {
    expect(isInsufficientStockError(new Error("INSUFFICIENT_STOCK: producto x"))).toBe(true);
  });
  it("no confunde otros errores (p.ej. RPC ausente)", () => {
    expect(isInsufficientStockError(new Error("function adjust_stock_batch does not exist"))).toBe(false);
    expect(isInsufficientStockError(null)).toBe(false);
  });
});
