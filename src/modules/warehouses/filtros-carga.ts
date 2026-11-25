import "server-only";

/**
 * Filtros en las órdenes de carga (carga sugerida, 2026-11-25).
 *
 * Los filtros viven en `product_filters` y su stock en `filter_stock`, aparte
 * de `warehouse_stock`. `loading_request_items` solo admite productos, así que
 * las líneas de filtros van en la tabla hermana `loading_request_filtros`
 * (migración 20261128130000). Todo tolerante: sin la tabla no hay filtros en
 * la orden y no falla nada.
 *
 * `filter_stock` no tiene RPC atómica como `adjust_stock_batch`; aquí se
 * mueve con compare-and-set sobre `quantity` (si otro cambió la fila entre
 * leer y escribir, se relee), que evita perder unidades por escrituras
 * cruzadas.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** ¿El error es «la tabla no existe» (migración sin aplicar)? */
export function esTablaQueFalta(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || e.code === "42703") return true;
  return /does not exist|schema cache|Could not find the table/i.test(e.message ?? "");
}

/** Unidades por filtro en un almacén (todas sus celdas). */
export async function filtrosEnAlmacen(admin: Admin, companyId: string, warehouseId: string): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const { data, error } = await admin
    .from("filter_stock")
    .select("filter_id, quantity")
    .eq("company_id", companyId)
    .eq("warehouse_id", warehouseId)
    .gt("quantity", 0)
    .limit(1000);
  if (error) return m;
  for (const r of (data ?? []) as Array<{ filter_id: string; quantity: number }>) {
    m.set(r.filter_id, (m.get(r.filter_id) ?? 0) + (r.quantity ?? 0));
  }
  return m;
}

async function descontarFiltro(
  admin: Admin,
  companyId: string,
  warehouseId: string,
  filterId: string,
  cantidad: number,
): Promise<number> {
  let restante = cantidad;
  for (let intento = 0; intento < 3 && restante > 0; intento++) {
    const { data } = await admin
      .from("filter_stock")
      .select("id, quantity")
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId)
      .eq("filter_id", filterId)
      .gt("quantity", 0)
      .order("quantity", { ascending: false });
    const filas = (data ?? []) as Array<{ id: string; quantity: number }>;
    if (filas.length === 0) break;
    for (const f of filas) {
      if (restante <= 0) break;
      const tomar = Math.min(f.quantity, restante);
      const { data: upd } = await admin
        .from("filter_stock")
        .update({ quantity: f.quantity - tomar, updated_at: new Date().toISOString() })
        .eq("id", f.id)
        .eq("quantity", f.quantity)
        .select("id");
      if (((upd ?? []) as unknown[]).length > 0) restante -= tomar;
    }
  }
  return cantidad - restante;
}

async function sumarFiltro(
  admin: Admin,
  companyId: string,
  warehouseId: string,
  filterId: string,
  cantidad: number,
): Promise<boolean> {
  for (let intento = 0; intento < 3; intento++) {
    const { data: fila } = await admin
      .from("filter_stock")
      .select("id, quantity")
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId)
      .eq("filter_id", filterId)
      .is("location_id", null)
      .order("updated_at")
      .limit(1)
      .maybeSingle();
    if (fila) {
      const f = fila as { id: string; quantity: number };
      const { data: upd } = await admin
        .from("filter_stock")
        .update({ quantity: f.quantity + cantidad, updated_at: new Date().toISOString() })
        .eq("id", f.id)
        .eq("quantity", f.quantity)
        .select("id");
      if (((upd ?? []) as unknown[]).length > 0) return true;
      continue;
    }
    const { error } = await admin.from("filter_stock").insert({
      company_id: companyId,
      warehouse_id: warehouseId,
      filter_id: filterId,
      quantity: cantidad,
    });
    if (!error) return true;
  }
  return false;
}

/**
 * Mueve las líneas de filtros de una orden de carga del origen al destino.
 * Devuelve los faltantes (lo que no se pudo mover). La orden ya está marcada
 * como entregada (compare-and-set del llamador), así que esto corre una vez.
 */
export async function entregarFiltrosDeOrden(
  admin: Admin,
  orden: { id: string; company_id: string; source_warehouse_id: string; destination_warehouse_id: string },
  userId: string,
): Promise<Array<{ filter_id: string; requested: number; delivered: number }>> {
  const { data, error } = await admin
    .from("loading_request_filtros")
    .select("id, filter_id, cantidad_pedida")
    .eq("loading_request_id", orden.id)
    .eq("company_id", orden.company_id);
  if (error) {
    if (!esTablaQueFalta(error)) console.error("[entregarFiltrosDeOrden]", error.message);
    return [];
  }
  const faltas: Array<{ filter_id: string; requested: number; delivered: number }> = [];
  for (const l of (data ?? []) as Array<{ id: string; filter_id: string; cantidad_pedida: number }>) {
    const movido = await descontarFiltro(admin, orden.company_id, orden.source_warehouse_id, l.filter_id, l.cantidad_pedida);
    let entregado = 0;
    if (movido > 0) {
      const ok = await sumarFiltro(admin, orden.company_id, orden.destination_warehouse_id, l.filter_id, movido);
      if (ok) {
        entregado = movido;
      } else {
        // Se descontó del origen y no se pudo sumar en destino: se devuelve al
        // origen para no perder unidades.
        console.error("[entregarFiltrosDeOrden] no se pudo sumar en destino", orden.id, l.filter_id);
        await sumarFiltro(admin, orden.company_id, orden.source_warehouse_id, l.filter_id, movido);
      }
    }
    if (entregado > 0) {
      try {
        await admin.from("filter_stock_movements").insert([
          {
            company_id: orden.company_id,
            filter_id: l.filter_id,
            warehouse_id: orden.source_warehouse_id,
            destination_warehouse_id: orden.destination_warehouse_id,
            movement_type: "transfer_out",
            quantity: entregado,
            notes: "Carga vehículo",
            performed_by: userId,
          },
          {
            company_id: orden.company_id,
            filter_id: l.filter_id,
            warehouse_id: orden.destination_warehouse_id,
            movement_type: "transfer_in",
            quantity: entregado,
            notes: "Recepción vehículo",
            performed_by: userId,
          },
        ]);
      } catch {
        /* rastro fail-soft */
      }
    }
    await admin.from("loading_request_filtros").update({ cantidad_entregada: entregado }).eq("id", l.id);
    if (entregado < l.cantidad_pedida) {
      faltas.push({ filter_id: l.filter_id, requested: l.cantidad_pedida, delivered: entregado });
    }
  }
  return faltas;
}
