import "server-only";
import { idsPackCompleto, type FilaPack } from "@/shared/lib/packs/complemento";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Pack con complemento (Horeca + ósmosis/UF): amplía la selección con las
 * otras partes ACTIVAS del pack del mismo cliente. Solo se llama cuando el
 * usuario elige «el pack entero»: una parte también puede retirarse sola
 * (Mario 2026-11-28). Los extras de siempre no se tocan.
 *
 * Defensivo: si la columna pack_role no existe (migración 20261127100000 sin
 * aplicar) o falla la lectura, devuelve la selección tal cual.
 */
export async function ampliarConPackCompleto(
  admin: Admin,
  companyId: string,
  customerId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return ids;
  const { data, error } = await admin
    .from("customer_equipment")
    .select("id, parent_equipment_id, pack_role, is_active")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .eq("is_active", true);
  if (error) return ids;
  const filas = ((data ?? []) as Array<FilaPack & { is_active: boolean }>).map((f) => ({
    id: String(f.id).toLowerCase(),
    parent_equipment_id: f.parent_equipment_id ? String(f.parent_equipment_id).toLowerCase() : null,
    pack_role: f.pack_role === "complemento" || f.pack_role === "extra" ? f.pack_role : null,
  }));
  return idsPackCompleto(
    ids.map((x) => String(x).toLowerCase()),
    filas,
  );
}
