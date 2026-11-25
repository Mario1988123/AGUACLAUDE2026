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
  return /parent_item_id|pack_role|schema cache|Could not find|42703/i.test(msg ?? "");
}

function faltaPackRole(msg: string | null | undefined): boolean {
  return /pack_role/i.test(msg ?? "");
}

/**
 * UPDATE del vínculo (y del rol, si lo hay). Si la columna pack_role aún no
 * existe (migración 20261127100000 sin aplicar), reintenta solo con el padre.
 */
async function actualizarVinculo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  table: string,
  companyId: string | null,
  childId: string,
  parentId: string,
  rol: string | null,
  etiqueta: string,
): Promise<void> {
  const payload: Record<string, unknown> = { parent_item_id: parentId };
  if (rol) payload.pack_role = rol;
  let upd = await client.from(table).update(payload).eq("id", childId).eq("company_id", companyId);
  if (upd.error && rol && faltaPackRole(upd.error.message)) {
    upd = await client
      .from(table)
      .update({ parent_item_id: parentId })
      .eq("id", childId)
      .eq("company_id", companyId);
  }
  if (upd.error && !isMissingColumn(upd.error.message)) {
    console.error(`[${etiqueta} ${table}]`, upd.error.message);
  }
}

export interface FilaOrigenPack {
  id: string;
  display_order: number | null;
  parent_item_id: string | null;
  pack_role?: string | null;
}

/**
 * Lee las líneas de origen con su vínculo de pack para copiarlo al siguiente
 * nivel. Defensivo: sin la columna pack_role, la lee sin ella; sin
 * parent_item_id, devuelve null (no hay nada que enlazar).
 */
export async function leerOrigenPack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  table: string,
  fkCol: string,
  fkVal: string,
): Promise<FilaOrigenPack[] | null> {
  const conRol = await client
    .from(table)
    .select("id, display_order, parent_item_id, pack_role")
    .eq(fkCol, fkVal);
  if (!conRol.error) return (conRol.data ?? []) as FilaOrigenPack[];
  const sinRol = await client
    .from(table)
    .select("id, display_order, parent_item_id")
    .eq(fkCol, fkVal);
  if (sinRol.error) return null;
  return (sinRol.data ?? []) as FilaOrigenPack[];
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
  /** Rol de cada línea (mismo índice). Opcional: sin él, como hoy. */
  roleByOrder?: Array<string | null>,
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
      await actualizarVinculo(
        client,
        table,
        companyId,
        childId,
        parentId,
        roleByOrder?.[i] ?? null,
        "linkItemsByParentIndex",
      );
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
  sourceRows: FilaOrigenPack[],
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
      // El rol (extra | complemento) viaja con el vínculo al siguiente nivel.
      await actualizarVinculo(
        client,
        table,
        companyId,
        childId,
        parentId,
        s.pack_role ?? null,
        "relinkCopiedItems",
      );
    }
  } catch (e) {
    console.error(`[relinkCopiedItems ${table}]`, e);
  }
}
