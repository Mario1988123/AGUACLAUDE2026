"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { adjustStockBatch, isInsufficientStockError, isFunctionMissingError } from "./adjust-stock";

interface TransferArgs {
  from_warehouse_id: string;
  to_warehouse_id: string;
  product_id: string;
  quantity: number;
  notes?: string;
}

/**
 * Transferencia de stock entre dos almacenes de la misma empresa.
 * Genera dos stock_movements (transfer_out + transfer_in) y notifica al admin.
 */
export async function transferStockAction(args: TransferArgs): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (args.from_warehouse_id === args.to_warehouse_id)
    throw new Error("Origen y destino son el mismo almacén");
  if (args.quantity <= 0) throw new Error("Cantidad debe ser mayor que 0");
  // SEGURIDAD: el admin client salta RLS → verificar que AMBOS almacenes son
  // de tu empresa antes de mover stock entre ellos.
  const { assertWarehouseCompany } = await import("./ownership");
  await assertWarehouseCompany(args.from_warehouse_id, session.company_id);
  await assertWarehouseCompany(args.to_warehouse_id, session.company_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Mutación de stock ATÓMICA (adjust_stock_batch): las dos patas — salida del
  // origen + entrada al destino — se aplican en UNA transacción → sin evaporación
  // de stock ni lost updates. Ambos almacenes usan la celda location=null (montón
  // general), igual que hasta ahora. Si la RPC aún no está en la BD (migración sin
  // aplicar) o falla por un motivo que NO sea de negocio, caemos al camino clásico
  // → nunca peor que hoy; se auto-mejora en cuanto la migración esté aplicada.
  let usedAtomic = false;
  try {
    await adjustStockBatch(session.company_id, session.user_id, [
      {
        warehouse_id: args.from_warehouse_id,
        product_id: args.product_id,
        delta: -args.quantity,
        movement_type: "transfer_out",
        destination_warehouse_id: args.to_warehouse_id,
        notes: args.notes ?? null,
      },
      {
        warehouse_id: args.to_warehouse_id,
        product_id: args.product_id,
        delta: args.quantity,
        movement_type: "transfer_in",
        notes: args.notes ?? null,
      },
    ]);
    usedAtomic = true;
  } catch (e) {
    // Stock insuficiente = error de negocio real → NO hacemos fallback.
    if (isInsufficientStockError(e)) {
      throw new Error("Stock insuficiente en almacén origen");
    }
    // Solo caemos al camino clásico si la RPC NO existe (migración sin aplicar).
    // Cualquier otro error (transporte/timeout): la RPC pudo haber commiteado →
    // NO reintentamos por legacy (duplicaría la transferencia), propagamos.
    if (!isFunctionMissingError(e)) throw e instanceof Error ? e : new Error(String(e));
    usedAtomic = false;
  }

  if (!usedAtomic) {
    // ---- Camino clásico (legacy, no atómico): solo si la RPC no está disponible ----
    // Validar stock en origen (state='new' por defecto)
    const { data: src } = await admin
      .from("warehouse_stock")
      .select("id, quantity")
      .eq("warehouse_id", args.from_warehouse_id)
      .eq("product_id", args.product_id)
      .eq("state", "new")
      .is("location_id", null)
      .maybeSingle();
    const srcRow = src as { id: string; quantity: number } | null;
    if (!srcRow || srcRow.quantity < args.quantity)
      throw new Error("Stock insuficiente en almacén origen");

    // Decrementar origen
    await admin
      .from("warehouse_stock")
      .update({ quantity: srcRow.quantity - args.quantity })
      .eq("id", srcRow.id);

    // Incrementar destino (upsert)
    const { data: dst } = await admin
      .from("warehouse_stock")
      .select("id, quantity")
      .eq("warehouse_id", args.to_warehouse_id)
      .eq("product_id", args.product_id)
      .eq("state", "new")
      .is("location_id", null)
      .maybeSingle();
    const dstRow = dst as { id: string; quantity: number } | null;
    if (dstRow) {
      await admin
        .from("warehouse_stock")
        .update({ quantity: dstRow.quantity + args.quantity })
        .eq("id", dstRow.id);
    } else {
      await admin.from("warehouse_stock").insert({
        company_id: session.company_id,
        warehouse_id: args.to_warehouse_id,
        product_id: args.product_id,
        quantity: args.quantity,
        state: "new",
      });
    }

    // Movimientos
    await admin.from("stock_movements").insert([
      {
        company_id: session.company_id,
        product_id: args.product_id,
        warehouse_id: args.from_warehouse_id,
        destination_warehouse_id: args.to_warehouse_id,
        movement_type: "transfer_out",
        quantity: args.quantity,
        performed_by: session.user_id,
        notes: args.notes ?? null,
      },
      {
        company_id: session.company_id,
        product_id: args.product_id,
        warehouse_id: args.to_warehouse_id,
        movement_type: "transfer_in",
        quantity: args.quantity,
        performed_by: session.user_id,
        notes: args.notes ?? null,
      },
    ]);
  }

  // Notificar admin
  const { data: admins } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("company_id", session.company_id)
    .eq("role_key", "company_admin")
    .is("revoked_at", null);
  const { data: prod } = await admin
    .from("products")
    .select("name")
    .eq("id", args.product_id)
    .maybeSingle();
  const { data: whs } = await admin
    .from("warehouses")
    .select("id, name")
    .in("id", [args.from_warehouse_id, args.to_warehouse_id]);
  const whMap = new Map(((whs ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]));
  const fromName = whMap.get(args.from_warehouse_id) ?? "?";
  const toName = whMap.get(args.to_warehouse_id) ?? "?";
  const prodName = (prod as { name: string } | null)?.name ?? "Producto";
  for (const a of (admins ?? []) as Array<{ user_id: string }>) {
    if (a.user_id === session.user_id) continue;
    await admin.from("notifications").insert({
      company_id: session.company_id,
      recipient_user_id: a.user_id,
      kind: "stock_transfer",
      severity: "info",
      title: "Transferencia de stock",
      body: `${args.quantity}× ${prodName}: ${fromName} → ${toName}`,
    });
  }

  revalidatePath("/almacenes");
}

// =================== Safe wrapper ===================

export async function transferStockSafeAction(
  args: TransferArgs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await transferStockAction(args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
