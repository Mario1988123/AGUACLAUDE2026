"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

async function ensureCanManage() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    throw new Error("Solo admin o director técnico puede registrar compras");
  }
  return session;
}

export interface PurchaseLineInput {
  product_id: string;
  quantity: number;
  unit_cost_cents: number;
  notes?: string;
  /** Código de lote del proveedor (opcional). Si null, usamos
   *  invoice_number como lot_code. */
  lot_code?: string | null;
}

/**
 * Registra una compra completa: cabecera + líneas. Por cada línea:
 *  1. Genera o suma stock en warehouse_stock (state=new, location=null).
 *  2. Crea un stock_movement tipo inbound con purchase_id enlazado.
 *  3. Recalcula el coste medio ponderado de products.cost_cents:
 *     CMP_nuevo = (stock_anterior × CMP_anterior + cantidad × coste_compra)
 *               / (stock_anterior + cantidad)
 */
export async function createPurchaseAction(input: {
  warehouse_id: string;
  supplier_name: string;
  supplier_tax_id?: string;
  invoice_number: string;
  invoice_date: string;       // YYYY-MM-DD
  notes?: string;
  items: PurchaseLineInput[];
}): Promise<{ ok: true; purchase_id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureCanManage();
    if (!input.supplier_name.trim()) return { ok: false, error: "Falta proveedor" };
    if (!input.invoice_number.trim()) return { ok: false, error: "Falta nº de albarán/factura" };
    if (!input.items.length) return { ok: false, error: "Sin líneas" };
    for (const it of input.items) {
      if (!it.product_id) return { ok: false, error: "Producto vacío en alguna línea" };
      if (it.quantity <= 0) return { ok: false, error: "Cantidad debe ser > 0" };
      if (it.unit_cost_cents < 0) return { ok: false, error: "Coste no puede ser negativo" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const total = input.items.reduce(
      (s, it) => s + it.quantity * it.unit_cost_cents,
      0,
    );

    // 1) Cabecera
    const { data: purchase, error: pErr } = await admin
      .from("purchases")
      .insert({
        company_id: session.company_id,
        warehouse_id: input.warehouse_id,
        supplier_name: input.supplier_name.trim(),
        supplier_tax_id: input.supplier_tax_id?.trim() || null,
        invoice_number: input.invoice_number.trim(),
        invoice_date: input.invoice_date,
        total_cents: total,
        notes: input.notes?.trim() || null,
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (pErr) {
      const msg = pErr.message ?? "";
      if (
        /schema cache|Could not find the table/i.test(msg) ||
        (pErr as { code?: string }).code === "PGRST205"
      ) {
        return {
          ok: false,
          error:
            "PostgREST aún no ve la tabla 'purchases'. Aplica la migración 20260515150000_pgrst_reload_warehouse_intel.sql o ejecuta en el SQL editor de Supabase: NOTIFY pgrst, 'reload schema'; y vuelve a intentarlo.",
        };
      }
      return { ok: false, error: msg };
    }
    const purchaseId = (purchase as { id: string }).id;

    // 2) Líneas
    const lineRows = input.items.map((it) => ({
      purchase_id: purchaseId,
      company_id: session.company_id,
      product_id: it.product_id,
      quantity: it.quantity,
      unit_cost_cents: it.unit_cost_cents,
      notes: it.notes ?? null,
    }));
    const { error: lErr } = await admin.from("purchase_items").insert(lineRows);
    if (lErr) return { ok: false, error: lErr.message };

    // 3) Stock + movimientos + CMP por cada línea
    for (const it of input.items) {
      // Stock anterior (suma global del producto en TODA la empresa para CMP)
      const { data: allStock } = await admin
        .from("warehouse_stock")
        .select("quantity")
        .eq("product_id", it.product_id);
      const prevQty = ((allStock ?? []) as Array<{ quantity: number }>).reduce(
        (s, r) => s + r.quantity,
        0,
      );

      // Coste actual del producto (puede ser null)
      const { data: prod } = await admin
        .from("products")
        .select("cost_cents")
        .eq("id", it.product_id)
        .maybeSingle();
      const prevCost = (prod as { cost_cents: number | null } | null)?.cost_cents ?? 0;

      // CMP nuevo
      const newQty = prevQty + it.quantity;
      const cmp =
        newQty > 0
          ? Math.round((prevQty * prevCost + it.quantity * it.unit_cost_cents) / newQty)
          : it.unit_cost_cents;
      await admin
        .from("products")
        .update({ cost_cents: cmp })
        .eq("id", it.product_id);

      // Suma stock en almacén destino
      const { data: existing } = await admin
        .from("warehouse_stock")
        .select("id, quantity")
        .eq("warehouse_id", input.warehouse_id)
        .eq("product_id", it.product_id)
        .eq("state", "new")
        .is("location_id", null)
        .maybeSingle();
      const row = existing as { id: string; quantity: number } | null;
      if (row) {
        await admin
          .from("warehouse_stock")
          .update({ quantity: row.quantity + it.quantity })
          .eq("id", row.id);
      } else {
        await admin.from("warehouse_stock").insert({
          company_id: session.company_id,
          warehouse_id: input.warehouse_id,
          product_id: it.product_id,
          quantity: it.quantity,
          state: "new",
        });
      }

      // Movimiento inbound enlazado a la compra
      await admin.from("stock_movements").insert({
        company_id: session.company_id,
        product_id: it.product_id,
        warehouse_id: input.warehouse_id,
        movement_type: "inbound",
        quantity: it.quantity,
        state_after: "new",
        purchase_id: purchaseId,
        performed_by: session.user_id,
        notes: `Albarán ${input.invoice_number} (${input.supplier_name})`,
      });

      // Auto-crear lote FIFO para trazabilidad. Fail-soft si la tabla no
      // está migrada todavía. lot_code preferentemente el del proveedor
      // (línea); si no se rellenó, usamos el nº de albarán.
      try {
        await admin.from("stock_lots").insert({
          company_id: session.company_id,
          product_id: it.product_id,
          warehouse_id: input.warehouse_id,
          lot_code:
            (it.lot_code?.trim() || null) ??
            (input.invoice_number.trim() || null),
          received_at: new Date(input.invoice_date + "T12:00:00").toISOString(),
          initial_quantity: it.quantity,
          remaining_quantity: it.quantity,
          unit_cost_cents: it.unit_cost_cents,
          notes: input.supplier_name.trim() || null,
          created_by: session.user_id,
        });
      } catch (e) {
        console.error("[createPurchase] stock_lots insert failed:", e);
      }
    }

    revalidatePath(`/almacenes/${input.warehouse_id}`);
    revalidatePath("/almacenes");
    return { ok: true, purchase_id: purchaseId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export interface PurchaseRow {
  id: string;
  warehouse_id: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  total_cents: number | null;
  notes: string | null;
  created_at: string;
  items_count: number;
  total_units: number;
}

export async function listPurchases(warehouseId?: string): Promise<PurchaseRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let q = supabase
    .from("purchases")
    .select(
      "id, warehouse_id, supplier_name, invoice_number, invoice_date, total_cents, notes, created_at",
    )
    .order("invoice_date", { ascending: false });
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data: purchases } = await q;
  type P = Omit<PurchaseRow, "items_count" | "total_units">;
  const list = (purchases ?? []) as P[];
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id);
  const { data: items } = await supabase
    .from("purchase_items")
    .select("purchase_id, quantity")
    .in("purchase_id", ids);
  const counts = new Map<string, { c: number; u: number }>();
  for (const it of (items ?? []) as Array<{ purchase_id: string; quantity: number }>) {
    const m = counts.get(it.purchase_id) ?? { c: 0, u: 0 };
    m.c += 1;
    m.u += it.quantity;
    counts.set(it.purchase_id, m);
  }
  return list.map((p) => {
    const c = counts.get(p.id) ?? { c: 0, u: 0 };
    return { ...p, items_count: c.c, total_units: c.u };
  });
}

export interface PurchaseDetail extends PurchaseRow {
  supplier_tax_id: string | null;
  items: Array<{
    id: string;
    product_id: string;
    product_name: string;
    quantity: number;
    unit_cost_cents: number;
    notes: string | null;
  }>;
}

export async function getPurchase(id: string): Promise<PurchaseDetail | null> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: p } = await supabase
    .from("purchases")
    .select(
      "id, warehouse_id, supplier_name, supplier_tax_id, invoice_number, invoice_date, total_cents, notes, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;
  const head = p as Omit<PurchaseDetail, "items" | "items_count" | "total_units">;

  const { data: items } = await supabase
    .from("purchase_items")
    .select("id, product_id, quantity, unit_cost_cents, notes")
    .eq("purchase_id", id);
  type I = {
    id: string;
    product_id: string;
    quantity: number;
    unit_cost_cents: number;
    notes: string | null;
  };
  const list = (items ?? []) as I[];
  const productIds = Array.from(new Set(list.map((i) => i.product_id)));
  let pMap = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name")
      .in("id", productIds);
    pMap = new Map(
      ((prods ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]),
    );
  }
  return {
    ...head,
    items_count: list.length,
    total_units: list.reduce((s, i) => s + i.quantity, 0),
    items: list.map((i) => ({
      ...i,
      product_name: pMap.get(i.product_id) ?? "?",
    })),
  };
}

/**
 * Devuelve a proveedor parte de una compra. Valida que la cantidad a
 * devolver no supere lo comprado menos lo ya devuelto.
 */
export async function returnToSupplierAction(input: {
  purchase_id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  reason?: string;
}): Promise<void> {
  const session = await ensureCanManage();
  if (input.quantity <= 0) throw new Error("Cantidad > 0");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Cantidad comprada en esta compra para este producto
  const { data: bought } = await admin
    .from("purchase_items")
    .select("quantity")
    .eq("purchase_id", input.purchase_id)
    .eq("product_id", input.product_id);
  const totalBought = ((bought ?? []) as Array<{ quantity: number }>).reduce(
    (s, r) => s + r.quantity,
    0,
  );
  // Ya devuelto antes
  const { data: returned } = await admin
    .from("stock_movements")
    .select("quantity")
    .eq("purchase_id", input.purchase_id)
    .eq("product_id", input.product_id)
    .eq("movement_type", "outbound_return_supplier");
  const totalReturned = ((returned ?? []) as Array<{ quantity: number }>).reduce(
    (s, r) => s + r.quantity,
    0,
  );
  const remaining = totalBought - totalReturned;
  if (input.quantity > remaining) {
    throw new Error(
      `Solo quedan ${remaining} ud de esa compra para devolver (comprado: ${totalBought}, ya devuelto: ${totalReturned})`,
    );
  }

  // Stock disponible en el almacén
  const { data: stock } = await admin
    .from("warehouse_stock")
    .select("id, quantity")
    .eq("warehouse_id", input.warehouse_id)
    .eq("product_id", input.product_id)
    .eq("state", "new")
    .is("location_id", null)
    .maybeSingle();
  const sRow = stock as { id: string; quantity: number } | null;
  if (!sRow || sRow.quantity < input.quantity) {
    throw new Error(
      `Stock insuficiente en este almacén (${sRow?.quantity ?? 0} ud)`,
    );
  }
  await admin
    .from("warehouse_stock")
    .update({ quantity: sRow.quantity - input.quantity })
    .eq("id", sRow.id);

  await admin.from("stock_movements").insert({
    company_id: session.company_id,
    product_id: input.product_id,
    warehouse_id: input.warehouse_id,
    movement_type: "outbound_return_supplier",
    quantity: input.quantity,
    purchase_id: input.purchase_id,
    performed_by: session.user_id,
    reason: input.reason ?? "Devolución a proveedor",
  });

  revalidatePath(`/almacenes/${input.warehouse_id}`);
}

// =================== Safe wrapper ===================

export async function returnToSupplierSafeAction(input: {
  purchase_id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  reason?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await returnToSupplierAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
