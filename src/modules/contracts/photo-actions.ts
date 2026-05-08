"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { ensureBucket, pickImageExt } from "@/shared/lib/supabase/storage-buckets";

const BUCKET = "contract-photos";

export type ContractPhotoKind = "id_card" | "other";

export interface ContractPhoto {
  id: string;
  kind: ContractPhotoKind;
  storage_path: string;
  signed_url: string | null;
  uploaded_at: string;
}

/**
 * Sube una foto al bucket privado y registra la metadata. Devuelve la fila
 * creada con una signed URL temporal para mostrar.
 */
export async function uploadContractPhotoAction(
  formData: FormData,
): Promise<ContractPhoto> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const file = formData.get("file");
  const contractId = String(formData.get("contract_id") ?? "");
  const kind = String(formData.get("kind") ?? "other") as ContractPhotoKind;
  if (!(file instanceof Blob)) throw new Error("Archivo inválido");
  if (!contractId) throw new Error("Falta contract_id");
  if (file.size > 10 * 1024 * 1024) throw new Error("Máximo 10 MB");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Garantizamos que el bucket existe ANTES del upload. Antes asumíamos
  // que el usuario lo había creado a mano en el panel de Supabase y al
  // deployar saltaba `Bucket not found` digest 3556820431.
  const ok = await ensureBucket(admin, BUCKET);
  if (!ok) throw new Error("No se pudo preparar el bucket de fotos del contrato");

  // pickImageExt soporta HEIC/HEIF del iPhone (antes el contentType era
  // heic pero la extensión .jpg, fallaba al renderizar).
  const ext = pickImageExt({
    name: (file as Blob & { name?: string }).name,
    type: file.type,
  });
  const ts = Date.now();
  const path = `${session.company_id}/${contractId}/${kind}-${ts}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const contentType =
    file.type ||
    (ext === "heic" ? "image/heic" : ext === "heif" ? "image/heif" : "image/jpeg");
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType,
    upsert: false,
    cacheControl: "3600",
  });
  if (error) {
    console.error("[uploadContractPhoto] upload failed:", error.message);
    throw new Error(`Storage: ${error.message}`);
  }

  const { data: row, error: e2 } = await admin
    .from("contract_photos")
    .insert({
      company_id: session.company_id,
      contract_id: contractId,
      kind,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: session.user_id,
    })
    .select("id, kind, storage_path, uploaded_at")
    .single();
  if (e2) {
    const code = (e2 as { code?: string }).code;
    const msg = (e2 as { message?: string }).message ?? "";
    if (
      code === "PGRST205" ||
      code === "42P01" ||
      /could not find the table|does not exist/i.test(msg)
    ) {
      throw new Error(
        "La tabla contract_photos no está disponible. Ejecuta la migración pendiente o reinicia la cache de PostgREST con: notify pgrst, 'reload schema';",
      );
    }
    throw new Error(e2.message);
  }

  const { data: signed } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);

  revalidatePath(`/contratos/${contractId}`);
  return {
    ...(row as { id: string; kind: ContractPhotoKind; storage_path: string; uploaded_at: string }),
    signed_url: (signed as { signedUrl: string } | null)?.signedUrl ?? null,
  };
}

export async function listContractPhotos(contractId: string): Promise<ContractPhoto[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let rows: Array<{
    id: string;
    kind: ContractPhotoKind;
    storage_path: string;
    uploaded_at: string;
  }> = [];
  try {
    const { data, error } = await admin
      .from("contract_photos")
      .select("id, kind, storage_path, uploaded_at")
      .eq("contract_id", contractId)
      .order("uploaded_at", { ascending: false });
    if (error) {
      // PGRST205 = tabla no encontrada en cache de PostgREST. Fail-soft:
      // la página puede seguir funcionando sin fotos si la migración aún
      // no se ha aplicado o si la cache está obsoleta.
      const code = (error as { code?: string }).code;
      const msg = (error as { message?: string }).message ?? "";
      if (
        code === "PGRST205" ||
        code === "42P01" ||
        /could not find the table|does not exist/i.test(msg)
      ) {
        console.warn("[listContractPhotos] contract_photos no disponible:", msg);
        return [];
      }
      throw error;
    }
    rows = (data ?? []) as typeof rows;
  } catch (e) {
    console.error("[listContractPhotos] SELECT failed:", e);
    return [];
  }
  const out: ContractPhoto[] = [];
  for (const r of rows) {
    let signedUrl: string | null = null;
    try {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(r.storage_path, 3600);
      signedUrl = (signed as { signedUrl: string } | null)?.signedUrl ?? null;
    } catch (e) {
      // Bucket inexistente o storage caído → seguimos sin URL
      console.error("[listContractPhotos] createSignedUrl failed:", e);
    }
    out.push({ ...r, signed_url: signedUrl });
  }
  return out;
}

export async function deleteContractPhotoAction(photoId: string): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: row } = await admin
    .from("contract_photos")
    .select("storage_path, contract_id, company_id")
    .eq("id", photoId)
    .maybeSingle();
  const r = row as { storage_path: string; contract_id: string; company_id: string } | null;
  if (!r) return;
  if (r.company_id !== session.company_id) throw new Error("Otra empresa");
  await admin.storage.from(BUCKET).remove([r.storage_path]);
  await admin.from("contract_photos").delete().eq("id", photoId);
  revalidatePath(`/contratos/${r.contract_id}`);
}
