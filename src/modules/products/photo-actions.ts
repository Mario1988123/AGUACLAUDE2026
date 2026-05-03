"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

const BUCKET = "product-images";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin puede gestionar productos");
  return session;
}

/**
 * Sube la foto principal del producto al bucket público "product-images" y
 * actualiza products.image_url. El bucket debe existir; el admin del proyecto
 * lo crea una vez en Supabase Storage como público.
 */
export async function uploadProductPhotoAction(formData: FormData): Promise<string> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  const file = formData.get("file");
  const productId = String(formData.get("product_id") ?? "");
  if (!(file instanceof Blob)) throw new Error("Archivo inválido");
  if (!productId) throw new Error("Falta product_id");
  if (file.size > 4 * 1024 * 1024) throw new Error("Máximo 4 MB");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${session.company_id}/${productId}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || "image/jpeg",
    upsert: true,
    cacheControl: "0",
  });
  if (error) throw new Error(error.message);
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const url = `${(pub as { publicUrl: string }).publicUrl}?t=${Date.now()}`;
  await admin
    .from("products")
    .update({ main_image_url: url })
    .eq("id", productId)
    .eq("company_id", session.company_id);
  revalidatePath(`/productos/${productId}`);
  return url;
}

export async function clearProductPhotoAction(productId: string): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("products")
    .update({ main_image_url: null })
    .eq("id", productId)
    .eq("company_id", session.company_id);
  revalidatePath(`/productos/${productId}`);
}
