"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface BarcodeProductMatch {
  id: string;
  name: string;
  barcode: string | null;
  sku: string | null;
  total_stock: number;
}

/** Busca un producto por su barcode. Si no hay match, devuelve null
 *  para que el cliente sepa que tiene que registrarlo. */
export async function findProductByBarcode(
  barcode: string,
): Promise<BarcodeProductMatch | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("products")
    .select("id, name, barcode, sku")
    .eq("company_id", session.company_id)
    .eq("barcode", barcode.trim())
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const p = data as { id: string; name: string; barcode: string; sku: string | null };
  const { data: stocks } = await admin
    .from("warehouse_stock")
    .select("quantity")
    .eq("product_id", p.id);
  const total = ((stocks ?? []) as Array<{ quantity: number }>).reduce(
    (s, r) => s + Number(r.quantity),
    0,
  );
  return { ...p, total_stock: total };
}

/** Asocia un barcode a un producto ya existente (memorización). */
export async function setProductBarcodeAction(
  productId: string,
  barcode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!barcode || barcode.trim().length < 3) {
      return { ok: false, error: "Barcode inválido" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Comprobar que ese barcode no está ya en otro producto
    const { data: dup } = await admin
      .from("products")
      .select("id, name")
      .eq("company_id", session.company_id)
      .eq("barcode", barcode.trim())
      .neq("id", productId)
      .maybeSingle();
    if (dup) {
      const d = dup as { name: string };
      return {
        ok: false,
        error: `Ese barcode ya está asociado a "${d.name}"`,
      };
    }
    const r = await admin
      .from("products")
      .update({ barcode: barcode.trim() })
      .eq("id", productId)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/productos");
    revalidatePath(`/productos/${productId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}
