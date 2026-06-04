"use server";
/**
 * Documentos adjuntos al producto (manuales PDF, certificados, fichas de
 * fabricante). Modelo: product_documents (migración 20260604100200).
 *
 * Reglas:
 *   - Lectura: cualquier rol.
 *   - Escritura: solo admin.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";
import type { ProductDocKind } from "./documents-constants";

export interface ProductDocumentItem {
  id: string;
  kind: ProductDocKind;
  title: string;
  storage_path: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  is_public: boolean;
  display_order: number;
  created_at: string;
}

export async function listProductDocuments(
  productId: string,
): Promise<ProductDocumentItem[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_documents")
    .select(
      "id, kind, title, storage_path, file_size_bytes, mime_type, is_public, display_order, created_at",
    )
    .eq("product_id", productId)
    .order("display_order")
    .order("created_at", { ascending: false });
  return (data ?? []) as ProductDocumentItem[];
}

export async function addProductDocumentAction(input: {
  productId: string;
  kind: ProductDocKind;
  title: string;
  storagePath: string;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
  isPublic?: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };
    if (!input.title.trim()) return { ok: false, error: "Falta el título" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("product_documents")
      .insert({
        company_id: session.company_id,
        product_id: input.productId,
        kind: input.kind,
        title: input.title.trim(),
        storage_path: input.storagePath,
        file_size_bytes: input.fileSizeBytes ?? null,
        mime_type: input.mimeType ?? null,
        is_public: input.isPublic ?? false,
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/productos/${input.productId}`);
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteProductDocumentAction(
  documentId: string,
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_documents")
      .delete()
      .eq("id", documentId)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =============================================================================
// Subida de archivo: server action que recibe FormData con un File.
// Usa createAdminClient para escribir directamente en Storage; el bucket
// product-documents se crea si no existe (igual que el patrón ensureBucket).
// =============================================================================

const BUCKET = "product-documents";

async function ensureBucket(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: list } = await admin.storage.listBuckets();
  const has = ((list ?? []) as Array<{ name: string }>).some(
    (b) => b.name === BUCKET,
  );
  if (!has) {
    await admin.storage.createBucket(BUCKET, { public: false });
  }
}

export async function uploadProductDocumentAction(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    const productId = String(formData.get("product_id") ?? "").trim();
    const kind = String(formData.get("kind") ?? "other") as ProductDocKind;
    const title = String(formData.get("title") ?? "").trim();
    const isPublic = formData.get("is_public") === "on";
    const file = formData.get("file");

    if (!productId) return { ok: false, error: "Falta product_id" };
    if (!title) return { ok: false, error: "Falta el título" };
    if (!(file instanceof File)) return { ok: false, error: "Falta el archivo" };
    if (file.size > 25 * 1024 * 1024) {
      return { ok: false, error: "Archivo demasiado grande (máx 25 MB)" };
    }

    await ensureBucket();

    const safeName = file.name.replace(/[^a-z0-9.-]+/gi, "_").slice(0, 80);
    const storagePath = `${session.company_id}/${productId}/${Date.now()}-${safeName}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) return { ok: false, error: upErr.message };

    return await addProductDocumentAction({
      productId,
      kind,
      title,
      storagePath,
      fileSizeBytes: file.size,
      mimeType: file.type || null,
      isPublic,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Devuelve URL firmada de 1 hora para descargar el documento. Si is_public,
 * podríamos devolver getPublicUrl, pero por simplicidad servimos siempre
 * URL firmada.
 */
export async function getProductDocumentUrlAction(
  documentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: doc } = await admin
      .from("product_documents")
      .select("storage_path, company_id")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) return { ok: false, error: "Documento no encontrado" };
    if ((doc as { company_id: string }).company_id !== session.company_id) {
      return { ok: false, error: "Documento de otra empresa" };
    }

    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl((doc as { storage_path: string }).storage_path, 3600);
    if (error) return { ok: false, error: error.message };
    return { ok: true, url: (data as { signedUrl: string }).signedUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
