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

// Mapeo entre el "kind" externo y el kind canónico que se guarda en documents.
function toDocKind(k: ContractPhotoKind): string {
  return k === "id_card" ? "contract.id_card" : "contract.other";
}
function fromDocKind(k: string): ContractPhotoKind {
  return k === "contract.id_card" ? "id_card" : "other";
}

/**
 * Sube una foto al bucket privado y registra la metadata en documents.
 * Antes había una tabla dedicada `contract_photos` que se eliminó en
 * 20260507100000_audit_cleanup_indexes.sql en favor de la tabla genérica
 * `documents` con subject_type='contract'.
 */
export async function uploadContractPhotoAction(
  formData: FormData,
): Promise<
  { ok: true; photo: ContractPhoto } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const file = formData.get("file");
    const contractId = String(formData.get("contract_id") ?? "");
    const kind = String(formData.get("kind") ?? "other") as ContractPhotoKind;
    if (!(file instanceof Blob)) return { ok: false, error: "Archivo inválido" };
    if (!contractId) return { ok: false, error: "Falta contract_id" };
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: "Máximo 10 MB" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // SEGURIDAD: verificar que el contrato es de tu empresa antes de subirle
    // documentos (admin client salta RLS).
    const { data: ownContract } = await admin
      .from("contracts")
      .select("id")
      .eq("id", contractId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!ownContract)
      return { ok: false, error: "Contrato no encontrado o no pertenece a tu empresa" };

    const ok = await ensureBucket(admin, BUCKET);
    if (!ok)
      return {
        ok: false,
        error: "No se pudo preparar el bucket de fotos del contrato",
      };

    const ext = pickImageExt({
      name: (file as Blob & { name?: string }).name,
      type: file.type,
    });
    const ts = Date.now();
    const path = `${session.company_id}/${contractId}/${kind}-${ts}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const contentType =
      file.type ||
      (ext === "heic"
        ? "image/heic"
        : ext === "heif"
          ? "image/heif"
          : "image/jpeg");
    const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType,
      upsert: false,
      cacheControl: "3600",
    });
    if (error) {
      console.error("[uploadContractPhoto] upload failed:", error.message);
      return { ok: false, error: `Almacenamiento: ${error.message}` };
    }

    const filename =
      (file as Blob & { name?: string }).name ?? `${kind}-${ts}.${ext}`;
    const { data: row, error: e2 } = await admin
      .from("documents")
      .insert({
        company_id: session.company_id,
        subject_type: "contract",
        subject_id: contractId,
        kind: toDocKind(kind),
        filename,
        storage_bucket: BUCKET,
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: session.user_id,
      })
      .select("id, kind, storage_path, uploaded_at")
      .single();
    if (e2) return { ok: false, error: e2.message };

    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);

    revalidatePath(`/contratos/${contractId}`);
    const r = row as {
      id: string;
      kind: string;
      storage_path: string;
      uploaded_at: string;
    };
    return {
      ok: true,
      photo: {
        id: r.id,
        kind: fromDocKind(r.kind),
        storage_path: r.storage_path,
        uploaded_at: r.uploaded_at,
        signed_url:
          (signed as { signedUrl: string } | null)?.signedUrl ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

export async function listContractPhotos(contractId: string): Promise<ContractPhoto[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD (RGPD): admin client salta RLS → filtrar por company_id. Sin
  // esto se exponían fotos de DNI/NIE de contratos de otra empresa con su UUID.
  const { data, error } = await admin
    .from("documents")
    .select("id, kind, storage_path, uploaded_at")
    .eq("subject_type", "contract")
    .eq("subject_id", contractId)
    .eq("company_id", session.company_id)
    .in("kind", ["contract.id_card", "contract.other"])
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (error) {
    console.error("[listContractPhotos] SELECT failed:", error);
    return [];
  }
  type R = { id: string; kind: string; storage_path: string; uploaded_at: string };
  const rows = (data ?? []) as R[];
  const out: ContractPhoto[] = [];
  for (const r of rows) {
    let signedUrl: string | null = null;
    try {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(r.storage_path, 3600);
      signedUrl = (signed as { signedUrl: string } | null)?.signedUrl ?? null;
    } catch (e) {
      console.error("[listContractPhotos] createSignedUrl failed:", e);
    }
    out.push({
      id: r.id,
      kind: fromDocKind(r.kind),
      storage_path: r.storage_path,
      uploaded_at: r.uploaded_at,
      signed_url: signedUrl,
    });
  }
  return out;
}

export async function deleteContractPhotoAction(photoId: string): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: row } = await admin
    .from("documents")
    .select("storage_path, subject_id, company_id, storage_bucket")
    .eq("id", photoId)
    .eq("subject_type", "contract")
    .maybeSingle();
  const r = row as {
    storage_path: string;
    subject_id: string;
    company_id: string;
    storage_bucket: string;
  } | null;
  if (!r) return;
  if (r.company_id !== session.company_id) throw new Error("Otra empresa");
  await admin.storage.from(r.storage_bucket || BUCKET).remove([r.storage_path]);
  // Soft delete por consistencia con el resto de documents
  await admin
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", photoId);
  revalidatePath(`/contratos/${r.subject_id}`);
}

export async function deleteContractPhotoSafeAction(
  photoId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteContractPhotoAction(photoId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
