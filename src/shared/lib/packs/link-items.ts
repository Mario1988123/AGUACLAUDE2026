/**
 * Helpers para mantener el vínculo padre-hijo de PACKS (equipo principal + extras)
 * a lo largo de la cadena proposal_items → contract_items → installation_items.
 *
 * Todas las tablas de líneas usan `display_order` = índice de la línea y una
 * columna `parent_item_id` (self-FK, nullable) añadida en la migración
 * 20260703200000_equipment_packs.sql. Como en cada copia se preservan los
 * display_order, podemos reconstruir el vínculo aunque cambien los ids.
 *
 * DEFENSIVO: si la columna parent_item_id todavía no existe (migración sin
 * aplicar), los UPDATE fallan de forma controlada y NO rompen el flujo — el pack
 * queda como líneas sueltas hasta que se aplique la migración.
 */

function isMissingColumn(msg: string | null | undefined): boolean {
  return /parent_item_id|schema cache|Could not find|42703/i.test(msg ?? "");
}

/**
 * Enlaza líneas recién insertadas usando el ÍNDICE del padre indicado por el
 * cliente (parent_index dentro del mismo array). Para el alta de propuesta.
 */
export async function linkItemsByParentIndex(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  table: string,
  companyId: string | null,
  inserted: Array<{ id: string; display_order: number | null }> | null | undefined,
  parentIndexByOrder: Array<number | null>,
): Promise<void> {
  try {
    const idByOrder = new Map<number, string>();
    for (const r of (inserted ?? [])) {
      if (r.display_order != null) idByOrder.set(r.display_order, r.id);
    }
    for (let i = 0; i < parentIndexByOrder.length; i++) {
      const p = parentIndexByOrder[i];
      if (p == null) continue;
      const childId = idByOrder.get(i);
      const parentId = idByOrder.get(p);
      if (!childId || !parentId || childId === parentId) continue;
      const upd = await client
        .from(table)
        .update({ parent_item_id: parentId })
        .eq("id", childId)
        .eq("company_id", companyId);
      if (upd.error && !isMissingColumn(upd.error.message)) {
        console.error(`[linkItemsByParentIndex ${table}]`, upd.error.message);
      }
    }
  } catch (e) {
    console.error(`[linkItemsByParentIndex ${table}]`, e);
  }
}

/**
 * Reconstruye el vínculo padre-hijo tras COPIAR líneas de un nivel al siguiente
 * (proposal→contract, contract→installation), emparejando por display_order.
 */
export async function relinkCopiedItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  table: string,
  companyId: string | null,
  inserted: Array<{ id: string; display_order: number | null }> | null | undefined,
  sourceRows: Array<{ id: string; display_order: number | null; parent_item_id: string | null }>,
): Promise<void> {
  try {
    const destIdByOrder = new Map<number, string>();
    for (const r of (inserted ?? [])) {
      if (r.display_order != null) destIdByOrder.set(r.display_order, r.id);
    }
    const srcOrderById = new Map<string, number>();
    for (const s of sourceRows) {
      if (s.display_order != null) srcOrderById.set(s.id, s.display_order);
    }
    for (const s of sourceRows) {
      if (!s.parent_item_id || s.display_order == null) continue;
      const parentOrder = srcOrderById.get(s.parent_item_id);
      if (parentOrder == null) continue;
      const childId = destIdByOrder.get(s.display_order);
      const parentId = destIdByOrder.get(parentOrder);
      if (!childId || !parentId || childId === parentId) continue;
      const upd = await client
        .from(table)
        .update({ parent_item_id: parentId })
        .eq("id", childId)
        .eq("company_id", companyId);
      if (upd.error && !isMissingColumn(upd.error.message)) {
        console.error(`[relinkCopiedItems ${table}]`, upd.error.message);
      }
    }
  } catch (e) {
    console.error(`[relinkCopiedItems ${table}]`, e);
  }
}
