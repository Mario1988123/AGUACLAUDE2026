"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

const PHOTO_BUCKET = "installation-photos";
const SIG_BUCKET = "installation-signatures";

export interface InstallationItem {
  id: string;
  product_id: string;
  quantity: number;
  serial_number: string | null;
  notes: string | null;
}

export interface InstallationPhoto {
  id: string;
  storage_path: string;
  category: string;
  caption: string | null;
  taken_at: string;
  signed_url: string | null;
}

export interface InstallationSignature {
  id: string;
  signer_role: string;
  signer_name: string;
  signer_tax_id: string | null;
  context: string | null;
  signed_at: string;
  signature_data_url: string | null;
}

/**
 * Sube una foto del parte a Storage y la registra en installation_photos.
 * Categorías sugeridas: equipment, connection, damage, extra.
 */
export async function uploadInstallationPhotoAction(
  formData: FormData,
): Promise<InstallationPhoto> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const file = formData.get("file");
  const installationId = String(formData.get("installation_id") ?? "");
  const category = String(formData.get("category") ?? "extra");
  if (!(file instanceof Blob)) throw new Error("Archivo inválido");
  if (!installationId) throw new Error("Falta installation_id");
  if (file.size > 10 * 1024 * 1024) throw new Error("Máximo 10 MB");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const ts = Date.now();
  const path = `${session.company_id}/${installationId}/${category}-${ts}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  // Asegurar bucket (si no existe lo creamos privado, fail-soft)
  try {
    await admin.storage.createBucket(PHOTO_BUCKET, { public: false });
  } catch {
    /* ya existe o sin permiso, ignoramos */
  }

  const { error: upErr } = await admin.storage
    .from(PHOTO_BUCKET)
    .upload(path, buf, {
      contentType: file.type || "image/jpeg",
      upsert: false,
      cacheControl: "3600",
    });
  if (upErr) throw new Error(upErr.message);

  const { data: row, error: rowErr } = await admin
    .from("installation_photos")
    .insert({
      company_id: session.company_id,
      installation_id: installationId,
      category,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: session.user_id,
    })
    .select("id, storage_path, category, caption, taken_at")
    .single();
  if (rowErr) throw new Error(rowErr.message);

  const { data: signed } = await admin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, 3600);

  revalidatePath(`/instalaciones/${installationId}`);
  return {
    ...(row as {
      id: string;
      storage_path: string;
      category: string;
      caption: string | null;
      taken_at: string;
    }),
    signed_url: (signed as { signedUrl: string } | null)?.signedUrl ?? null,
  };
}

/**
 * Guarda firma del cliente o representante para la instalación. Acepta
 * data URL del canvas. Si la columna signature_data_url no existe en BD,
 * persistimos sólo la fila con signature_image_path vacío.
 */
export async function saveInstallationSignatureAction(input: {
  installation_id: string;
  signer_role: "customer" | "representative";
  signer_name: string;
  signer_tax_id: string | null;
  signature_data_url: string;
  /** initial_state | final | etc. */
  context?: string | null;
}): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const payload: Record<string, unknown> = {
    company_id: session.company_id,
    installation_id: input.installation_id,
    signer_role: input.signer_role,
    signer_name: input.signer_name,
    signer_tax_id: input.signer_tax_id,
    signature_data_url: input.signature_data_url,
    signature_image_path: "",
    context: input.context ?? null,
    signed_at: new Date().toISOString(),
  };

  let r = await admin.from("installation_signatures").insert(payload);
  if (r.error && /signature_data_url/i.test(r.error.message ?? "")) {
    delete payload.signature_data_url;
    r = await admin.from("installation_signatures").insert(payload);
  }
  if (r.error) throw new Error(r.error.message);
  revalidatePath(`/instalaciones/${input.installation_id}`);
}

/**
 * Devuelve las firmas con la data URL para mostrarlas en el wizard.
 */
export async function listInstallationSignaturesFull(
  installationId: string,
): Promise<InstallationSignature[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let r = await admin
    .from("installation_signatures")
    .select(
      "id, signer_role, signer_name, signer_tax_id, context, signed_at, signature_data_url",
    )
    .eq("installation_id", installationId)
    .order("signed_at");
  if (r.error && /signature_data_url/i.test(r.error.message ?? "")) {
    r = await admin
      .from("installation_signatures")
      .select("id, signer_role, signer_name, signer_tax_id, context, signed_at")
      .eq("installation_id", installationId)
      .order("signed_at");
  }
  if (r.error) return [];
  return ((r.data ?? []) as InstallationSignature[]).map((s) => ({
    ...s,
    signature_data_url: (s as { signature_data_url?: string | null }).signature_data_url ?? null,
  }));
}

/**
 * Devuelve las fotos del parte con signed URL para preview.
 */
export async function listInstallationPhotosFull(
  installationId: string,
): Promise<InstallationPhoto[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("installation_photos")
    .select("id, storage_path, category, caption, taken_at")
    .eq("installation_id", installationId)
    .order("taken_at", { ascending: false });
  type R = {
    id: string;
    storage_path: string;
    category: string;
    caption: string | null;
    taken_at: string;
  };
  const rows = (data ?? []) as R[];
  const out: InstallationPhoto[] = [];
  for (const r of rows) {
    const { data: signed } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(r.storage_path, 3600);
    out.push({
      ...r,
      signed_url: (signed as { signedUrl: string } | null)?.signedUrl ?? null,
    });
  }
  return out;
}

// Bucket SIG_BUCKET reservado para futura subida de imágenes (hoy
// guardamos data URL inline). Lo definimos para que el linter no
// se queje del const sin usar y para documentar la intención.
void SIG_BUCKET;
