"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Importación masiva de stock inicial desde CSV.
 *
 * Formato del CSV (separador `,` o `;`, con cabecera):
 *   product_reference,quantity,location_code,notes
 *
 * Reglas:
 *  - product_reference: matchea contra products.internal_reference o,
 *    si falla, contra products.name (case-insensitive).
 *  - quantity: entero positivo.
 *  - location_code (opcional): código compuesto de ubicación
 *    (ej "22C"). Debe existir en el almacén.
 *  - notes (opcional): aparece en stock_movements.notes.
 *
 * Solo admin / director técnico.
 */
export async function importStockCsvAction(input: {
  warehouse_id: string;
  csv_text: string;
}): Promise<{
  ok: boolean;
  inserted: number;
  errors: Array<{ line: number; reference: string; reason: string }>;
}> {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    throw new Error("Solo admin/director técnico");
  }
  if (!session.company_id) throw new Error("Sin empresa");
  // SEGURIDAD: el admin client salta RLS → verificar que el almacén es tuyo
  // antes de importar stock en él.
  const { assertWarehouseCompany } = await import("./ownership");
  await assertWarehouseCompany(input.warehouse_id, session.company_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const text = (input.csv_text ?? "").trim();
  if (!text) return { ok: false, inserted: 0, errors: [{ line: 0, reference: "", reason: "CSV vacío" }] };

  // Detectar separador
  const firstLine = text.split(/\r?\n/)[0]!;
  const sep = firstLine.includes(";") ? ";" : ",";

  const rows = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (rows.length < 2) {
    return { ok: false, inserted: 0, errors: [{ line: 0, reference: "", reason: "Sin filas de datos" }] };
  }
  const header = rows[0]!.split(sep).map((c) => c.trim().toLowerCase());
  const colIdx = {
    product_reference: header.indexOf("product_reference"),
    quantity: header.indexOf("quantity"),
    location_code: header.indexOf("location_code"),
    notes: header.indexOf("notes"),
  };
  if (colIdx.product_reference < 0 || colIdx.quantity < 0) {
    return {
      ok: false,
      inserted: 0,
      errors: [
        {
          line: 1,
          reference: "",
          reason: "Faltan columnas obligatorias product_reference y quantity",
        },
      ],
    };
  }

  // Cargamos productos y ubicaciones del almacén una sola vez
  const { data: prodsRaw } = await admin
    .from("products")
    .select("id, name, internal_reference")
    .eq("company_id", session.company_id)
    .is("deleted_at", null);
  type P = { id: string; name: string; internal_reference: string | null };
  const products = (prodsRaw ?? []) as P[];

  const { data: locsRaw } = await admin
    .from("warehouse_locations")
    .select("id, code")
    .eq("warehouse_id", input.warehouse_id);
  const locMap = new Map(
    ((locsRaw ?? []) as Array<{ id: string; code: string | null }>).map((l) => [
      (l.code ?? "").toUpperCase(),
      l.id,
    ]),
  );

  function findProduct(ref: string): P | null {
    const r = ref.trim();
    if (!r) return null;
    const byRef = products.find(
      (p) => (p.internal_reference ?? "").trim().toLowerCase() === r.toLowerCase(),
    );
    if (byRef) return byRef;
    const byName = products.find((p) => p.name.trim().toLowerCase() === r.toLowerCase());
    return byName ?? null;
  }

  const errors: Array<{ line: number; reference: string; reason: string }> = [];
  let inserted = 0;

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]!.split(sep).map((c) => c.trim());
    const ref = cells[colIdx.product_reference] ?? "";
    const qtyStr = cells[colIdx.quantity] ?? "";
    const locCode = colIdx.location_code >= 0 ? cells[colIdx.location_code] ?? "" : "";
    const notes = colIdx.notes >= 0 ? cells[colIdx.notes] ?? "" : "";

    const qty = Math.floor(Number(qtyStr));
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push({ line: i + 1, reference: ref, reason: "Cantidad inválida" });
      continue;
    }
    const product = findProduct(ref);
    if (!product) {
      errors.push({ line: i + 1, reference: ref, reason: "Producto no encontrado" });
      continue;
    }
    let locationId: string | null = null;
    if (locCode) {
      locationId = locMap.get(locCode.toUpperCase()) ?? null;
      if (!locationId) {
        errors.push({
          line: i + 1,
          reference: ref,
          reason: `Ubicación ${locCode} no existe en este almacén`,
        });
        continue;
      }
    }

    // Suma a la fila existente o inserta nueva
    const { data: existing } = await admin
      .from("warehouse_stock")
      .select("id, quantity")
      .eq("warehouse_id", input.warehouse_id)
      .eq("product_id", product.id)
      .eq("state", "new")
      .eq("location_id", locationId)
      .maybeSingle();
    const row = existing as { id: string; quantity: number } | null;
    if (row) {
      await admin
        .from("warehouse_stock")
        .update({ quantity: row.quantity + qty })
        .eq("id", row.id);
    } else {
      await admin.from("warehouse_stock").insert({
        company_id: session.company_id,
        warehouse_id: input.warehouse_id,
        product_id: product.id,
        quantity: qty,
        state: "new",
        location_id: locationId,
      });
    }
    await admin.from("stock_movements").insert({
      company_id: session.company_id,
      product_id: product.id,
      warehouse_id: input.warehouse_id,
      movement_type: "inbound",
      quantity: qty,
      state_after: "new",
      performed_by: session.user_id,
      notes: notes || "Importación CSV stock inicial",
      reason: "csv_initial_import",
    });
    inserted += 1;
  }

  revalidatePath(`/almacenes/${input.warehouse_id}`);
  revalidatePath("/almacenes");
  return { ok: errors.length === 0, inserted, errors };
}

/**
 * Valoración total del inventario por almacén = SUM(quantity × cost_cents).
 */
export interface InventoryValuation {
  warehouse_id: string;
  warehouse_name: string;
  warehouse_kind: string;
  total_units: number;
  total_value_cents: number;
}

export async function getInventoryValuation(): Promise<InventoryValuation[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: warehouses } = await admin
    .from("warehouses")
    .select("id, name, kind")
    .eq("company_id", session.company_id)
    .is("deleted_at", null);
  const whs = (warehouses ?? []) as Array<{
    id: string;
    name: string;
    kind: string;
  }>;
  if (whs.length === 0) return [];

  const { data: stocks } = await admin
    .from("warehouse_stock")
    .select("warehouse_id, product_id, quantity")
    .in(
      "warehouse_id",
      whs.map((w) => w.id),
    );
  type S = { warehouse_id: string; product_id: string; quantity: number };
  const list = (stocks ?? []) as S[];

  const productIds = Array.from(new Set(list.map((s) => s.product_id)));
  const costMap = new Map<string, number>();
  if (productIds.length > 0) {
    const { data: prods } = await admin
      .from("products")
      .select("id, cost_cents")
      .in("id", productIds);
    for (const p of (prods ?? []) as Array<{ id: string; cost_cents: number | null }>) {
      costMap.set(p.id, p.cost_cents ?? 0);
    }
  }

  return whs.map((w) => {
    const wsStocks = list.filter((s) => s.warehouse_id === w.id);
    const total_units = wsStocks.reduce((s, r) => s + r.quantity, 0);
    const total_value_cents = wsStocks.reduce(
      (s, r) => s + r.quantity * (costMap.get(r.product_id) ?? 0),
      0,
    );
    return {
      warehouse_id: w.id,
      warehouse_name: w.name,
      warehouse_kind: w.kind,
      total_units,
      total_value_cents,
    };
  });
}
