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

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string; ext: string } {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("dataURL inválido");
  const mime = match[1]!;
  const buffer = Buffer.from(match[2]!, "base64");
  const ext = mime.split("/")[1]?.split("+")[0] ?? "bin";
  return { buffer, mime, ext };
}

export async function uploadInstallationPhoto(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = parseOrFriendly(uploadSchema, input, "Foto instalación");
  const { buffer, mime, ext } = dataUrlToBuffer(parsed.data_url);

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
  const { buffer, mime, ext } = dataUrlToBuffer(parsed.data_url);

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
  await requireSession();
  const admin = createAdminClient();
  const { data } = await admin.storage.from("documents").createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}
