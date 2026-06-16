"use server";
/**
 * Catálogo maestro — FABRICANTES (solo superadmin).
 * Ficha de fabricante (nombre, logo, web, notas). Bajo cada fabricante cuelgan
 * sus productos maestros (ver master-products-actions.ts).
 *
 * Todo con service-role (createAdminClient) + guard ensureSuperadmin.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { ensureBucket, pickImageExt } from "@/shared/lib/supabase/storage-buckets";

const BUCKET = "catalog-global";

async function ensureSuperadmin() {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
  return session;
}

export interface ManufacturerItem {
  id: string;
  name: string;
  logo_path: string | null;
  website: string | null;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
  product_count: number;
}

export async function listManufacturers(): Promise<ManufacturerItem[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("manufacturers")
    .select("id, name, logo_path, website, notes, is_active, sort_order")
    .order("sort_order")
    .order("name");
  const rows = (data ?? []) as Array<Omit<ManufacturerItem, "product_count">>;
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const { data: prods } = await admin
      .from("catalog_products")
      .select("manufacturer_id");
    for (const p of (prods ?? []) as Array<{ manufacturer_id: string | null }>) {
      if (p.manufacturer_id)
        counts.set(p.manufacturer_id, (counts.get(p.manufacturer_id) ?? 0) + 1);
    }
  }
  return rows.map((r) => ({ ...r, product_count: counts.get(r.id) ?? 0 }));
}

export async function upsertManufacturerSafeAction(input: {
  id?: string;
  name: string;
  website?: string;
  notes?: string;
  sort_order?: number;
  is_active?: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureSuperadmin();
    const name = input.name.trim();
    if (!name) return { ok: false, error: "El nombre del fabricante es obligatorio" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const payload: Record<string, unknown> = {
      name,
      website: input.website?.trim() || null,
      notes: input.notes?.trim() || null,
    };
    if (input.sort_order != null) payload.sort_order = input.sort_order;
    if (input.is_active != null) payload.is_active = input.is_active;
    if (input.id) {
      const { error } = await admin.from("manufacturers").update(payload).eq("id", input.id);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/superadmin/catalogo/fabricantes");
      return { ok: true, id: input.id };
    }
    payload.created_by = session.user_id;
    const { data, error } = await admin
      .from("manufacturers")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/superadmin/catalogo/fabricantes");
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteManufacturerSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: prods } = await admin
      .from("catalog_products")
      .select("id")
      .eq("manufacturer_id", id)
      .limit(1);
    if ((prods ?? []).length > 0) {
      return {
        ok: false,
        error: "No se puede borrar: tiene productos. Desactívalo o muévelos antes.",
      };
    }
    const { error } = await admin.from("manufacturers").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/superadmin/catalogo/fabricantes");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function uploadManufacturerLogoAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    const id = String(formData.get("manufacturer_id") ?? "").trim();
    const file = formData.get("file");
    if (!id) return { ok: false, error: "Falta el fabricante" };
    if (!(file instanceof File)) return { ok: false, error: "Falta el archivo" };
    if (file.size > 5 * 1024 * 1024)
      return { ok: false, error: "Logo demasiado grande (máx 5 MB)" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const ready = await ensureBucket(admin, BUCKET);
    if (!ready) return { ok: false, error: "No se pudo preparar el almacén" };

    const ext = pickImageExt({ name: file.name, type: file.type });
    const path = `manufacturers/${id}/logo-${Date.now()}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type || "image/png", upsert: false });
    if (upErr) return { ok: false, error: upErr.message };

    const { error } = await admin
      .from("manufacturers")
      .update({ logo_path: path })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/superadmin/catalogo/fabricantes");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
