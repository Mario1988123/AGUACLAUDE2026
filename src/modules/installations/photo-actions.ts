"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const uploadSchema = z.object({
  installation_id: z.string().uuid(),
  category: z.string(),
  data_url: z.string().startsWith("data:"),
  mime_type: z.string(),
});

const signatureSchema = z.object({
  installation_id: z.string().uuid(),
  signer_role: z.enum(["customer", "installer", "witness"]).default("customer"),
  signer_name: z.string().min(2),
  signer_tax_id: z.string().optional(),
  data_url: z.string().startsWith("data:"),
  context: z.enum(["previous_damage", "countertop_drilling", "work_report"]).default("work_report"),
});

// SEGURIDAD: solo aceptamos imágenes razonables. Antes se confiaba en el
// mime del data URL, lo que permitía subir SVG (vector con <script>) y
// servirlo por URL firmada → XSS en Supabase Storage.
const ALLOWED_PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const ALLOWED_SIGNATURE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string; ext: string } {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("dataURL inválido");
  const mime = match[1]!;
  const buffer = Buffer.from(match[2]!, "base64");
  const ext = mime.split("/")[1]?.split("+")[0] ?? "bin";
  return { buffer, mime, ext };
}

async function assertInstallationOwnership(
  installationId: string,
  companyId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("installations")
    .select("id")
    .eq("id", installationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) throw new Error("Instalación no encontrada o no pertenece a tu empresa");
}

export async function uploadInstallationPhoto(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = parseOrFriendly(uploadSchema, input, "Foto instalación");
  await assertInstallationOwnership(parsed.installation_id, session.company_id);
  const { buffer, mime, ext } = dataUrlToBuffer(parsed.data_url);
  if (!ALLOWED_PHOTO_MIME.has(mime)) {
    throw new Error("Formato no soportado. Usa JPG, PNG, WEBP o HEIC.");
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Imagen demasiado grande (máx. 8 MB).");
  }

  const path = `${session.company_id}/installations/${parsed.installation_id}/${Date.now()}-${parsed.category}.${ext}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error: upErr } = await admin.storage
    .from("documents")
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`Upload: ${upErr.message}`);

  await admin.from("installation_photos").insert({
    installation_id: parsed.installation_id,
    company_id: session.company_id,
    storage_path: path,
    category: parsed.category,
    is_required: ["equipment_location", "network_connection"].includes(parsed.category),
    uploaded_by: session.user_id,
  });

  revalidatePath(`/instalaciones/${parsed.installation_id}`);
}

export async function uploadInstallationSignature(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = parseOrFriendly(signatureSchema, input, "Firma instalación");
  await assertInstallationOwnership(parsed.installation_id, session.company_id);
  const { buffer, mime, ext } = dataUrlToBuffer(parsed.data_url);
  if (!ALLOWED_SIGNATURE_MIME.has(mime)) {
    throw new Error("Formato de firma no soportado.");
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Firma demasiado grande.");
  }

  const path = `${session.company_id}/installations/${parsed.installation_id}/signature-${parsed.context}-${Date.now()}.${ext}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error: upErr } = await admin.storage
    .from("documents")
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`Upload firma: ${upErr.message}`);

  await admin.from("installation_signatures").insert({
    installation_id: parsed.installation_id,
    company_id: session.company_id,
    signer_role: parsed.signer_role,
    signer_name: parsed.signer_name,
    signer_tax_id: parsed.signer_tax_id ?? null,
    signature_image_path: path,
    context: parsed.context,
  });

  revalidatePath(`/instalaciones/${parsed.installation_id}`);
}

export async function getSignedPhotoUrl(storagePath: string): Promise<string | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // El path SIEMPRE empieza por el company_id (ver uploads arriba). Impide que
  // un usuario firme y descargue documentos de otra empresa pasando un path ajeno.
  if (!storagePath.startsWith(`${session.company_id}/`)) return null;
  const admin = createAdminClient();
  const { data } = await admin.storage.from("documents").createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}
