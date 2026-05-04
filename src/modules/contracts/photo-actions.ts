"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

const BUCKET = "contract-photos";

export type ContractPhotoKind = "id_card" | "iban" | "other";

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

  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const ts = Date.now();
  const path = `${session.company_id}/${contractId}/${kind}-${ts}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || "image/jpeg",
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);

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
  if (e2) throw new Error(e2.message);

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
  const { data } = await admin
    .from("contract_photos")
    .select("id, kind, storage_path, uploaded_at")
    .eq("contract_id", contractId)
    .order("uploaded_at", { ascending: false });
  type R = { id: string; kind: ContractPhotoKind; storage_path: string; uploaded_at: string };
  const rows = (data ?? []) as R[];
  const out: ContractPhoto[] = [];
  for (const r of rows) {
    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(r.storage_path, 3600);
    out.push({
      ...r,
      signed_url: (signed as { signedUrl: string } | null)?.signedUrl ?? null,
    });
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
