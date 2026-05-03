"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

const BUCKET = "avatars";

/**
 * Sube avatar al bucket público "avatars" de Supabase Storage. El bucket
 * debe existir y ser público (lectura). El path es {company_id}/{user_id}.{ext}.
 *
 * Recibe un FormData con el campo "file" (Blob).
 */
export async function uploadAvatarAction(formData: FormData): Promise<string> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const file = formData.get("file");
  if (!(file instanceof Blob)) throw new Error("Archivo inválido");
  if (file.size > 2 * 1024 * 1024) throw new Error("Máximo 2 MB");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${session.company_id}/${session.user_id}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || "image/jpeg",
    upsert: true,
    cacheControl: "0",
  });
  if (error) throw new Error(error.message);

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = `${(pub as { publicUrl: string }).publicUrl}?t=${Date.now()}`;
  await admin
    .from("user_profiles")
    .update({ avatar_url: publicUrl })
    .eq("user_id", session.user_id);
  revalidatePath("/configuracion/usuarios");
  revalidatePath("/", "layout");
  return publicUrl;
}

export async function clearAvatarAction(): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("user_profiles")
    .update({ avatar_url: null })
    .eq("user_id", session.user_id);
  revalidatePath("/", "layout");
}
