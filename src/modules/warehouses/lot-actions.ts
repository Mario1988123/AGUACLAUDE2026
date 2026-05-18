"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface StockLotRow {
  id: string;
  product_id: string;
  product_name: string;
  warehouse_id: string;
  lot_code: string | null;
  received_at: string;
  initial_quantity: number;
  remaining_quantity: number;
  unit_cost_cents: number | null;
  notes: string | null;
  created_at: string;
}

/**
 * Lista lotes de stock de un almacén concreto. Lotes "activos"
 * (remaining_quantity > 0) primero, después agotados (orden recepción).
 */
export async function listStockLots(input: {
  warehouse_id: string;
  include_depleted?: boolean;
}): Promise<StockLotRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    let q = admin
      .from("stock_lots")
      .select(
        "id, product_id, warehouse_id, lot_code, received_at, initial_quantity, remaining_quantity, unit_cost_cents, notes, created_at",
      )
      .eq("company_id", session.company_id)
      .eq("warehouse_id", input.warehouse_id)
      .order("remaining_quantity", { ascending: false })
      .order("received_at", { ascending: true })
      .limit(500);
    if (!input.include_depleted) q = q.gt("remaining_quantity", 0);
    const { data, error } = await q;
    if (error) {
      console.error("[listStockLots]", error.message);
      return [];
    }
    const rows = (data ?? []) as Array<Omit<StockLotRow, "product_name">>;
    if (rows.length === 0) return [];
    const productIds = Array.from(new Set(rows.map((r) => r.product_id)));
    const { data: prods } = await admin
      .from("products")
      .select("id, name")
      .in("id", productIds);
    const nameMap = new Map(
      ((prods ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
    );
    return rows.map((r) => ({
      ...r,
      product_name: nameMap.get(r.product_id) ?? "Producto",
    }));
  } catch (e) {
    console.error("[listStockLots] threw:", e);
    return [];
  }
}

const createLotSchema = z.object({
  warehouse_id: z.string().uuid(),
  product_id: z.string().uuid(),
  initial_quantity: z.coerce.number().positive(),
  lot_code: z.string().trim().max(50).nullish(),
  received_at: z.string().nullish(),
  unit_cost_cents: z.coerce.number().int().nonnegative().nullish(),
  notes: z.string().trim().max(500).nullish(),
});

/**
 * Crea un nuevo lote en BD. NO modifica `warehouse_stock` (esa tabla la
 * actualizan otros flujos: compras, traspasos, ajustes). El lote es
 * metadata de trazabilidad para FIFO.
 *
 * Restringido a admin / director técnico / instalador (cualquiera de
 * los tres puede registrar entrada al recibir mercancía).
 */
export async function createStockLotAction(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director") ||
      session.roles.includes("installer");
    if (!allowed) return { ok: false, error: "Sin permiso" };

    const parsed = parseOrFriendly(createLotSchema, input, "Nuevo lote");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      product_id: parsed.product_id,
      warehouse_id: parsed.warehouse_id,
      lot_code: parsed.lot_code ?? null,
      received_at: parsed.received_at ?? new Date().toISOString(),
      initial_quantity: parsed.initial_quantity,
      remaining_quantity: parsed.initial_quantity,
      unit_cost_cents: parsed.unit_cost_cents ?? null,
      notes: parsed.notes ?? null,
      created_by: session.user_id,
    };
    const { data, error } = await admin
      .from("stock_lots")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/almacenes/${parsed.warehouse_id}`);
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Elimina un lote (solo si remaining_quantity === initial_quantity, es
 * decir, sin consumir todavía). Si ya tuvo salidas, no se permite
 * borrar — sería un agujero de trazabilidad.
 */
export async function deleteStockLotAction(
  lotId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isUpper =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director");
    if (!isUpper) return { ok: false, error: "Solo admin o director técnico" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: lot } = await admin
      .from("stock_lots")
      .select("id, initial_quantity, remaining_quantity, warehouse_id, company_id")
      .eq("id", lotId)
      .maybeSingle();
    const l = lot as
      | {
          id: string;
          initial_quantity: number;
          remaining_quantity: number;
          warehouse_id: string;
          company_id: string;
        }
      | null;
    if (!l) return { ok: false, error: "Lote no encontrado" };
    if (l.company_id !== session.company_id) return { ok: false, error: "Otra empresa" };
    if (Number(l.remaining_quantity) !== Number(l.initial_quantity)) {
      return {
        ok: false,
        error:
          "El lote ya tiene salidas registradas. No se puede borrar (rompería la trazabilidad).",
      };
    }
    const r = await admin.from("stock_lots").delete().eq("id", lotId);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath(`/almacenes/${l.warehouse_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
