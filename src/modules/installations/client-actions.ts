"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { ensureBucket, pickImageExt } from "@/shared/lib/supabase/storage-buckets";
import { assertInstallationCompany } from "./ownership";

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

type UploadResult =
  | { ok: true; photo: InstallationPhoto }
  | { ok: false; error: string };

/**
 * Sube una foto del parte a Storage y la registra en installation_photos.
 * Categorías sugeridas: equipment, connection, damage, extra.
 *
 * Devuelve result discriminado para preservar el mensaje en producción
 * (Next.js redacta Error.message en server actions).
 */
export async function uploadInstallationPhotoAction(
  formData: FormData,
): Promise<UploadResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const file = formData.get("file");
    const installationId = String(formData.get("installation_id") ?? "");
    const category = String(formData.get("category") ?? "extra");
    if (!(file instanceof Blob)) return { ok: false, error: "Archivo inválido" };
    if (!installationId) return { ok: false, error: "Falta installation_id" };
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: "Máximo 10 MB" };
    // SEGURIDAD: admin salta RLS → verificar que la instalación es de tu empresa.
    await assertInstallationCompany(installationId, session.company_id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Derivar extensión soportando HEIC/HEIF del iPhone (antes se forzaba
    // a .jpg con contentType heic, archivo subía pero no se renderizaba).
    const ext = pickImageExt({
      name: (file as Blob & { name?: string }).name,
      type: file.type,
    });
    // Random sufijo para garantizar unicidad incluso si el usuario sube
    // múltiples fotos en el mismo milisegundo (bug reportado 2026-05-11:
    // la 3a foto fallaba — la causa más probable era colisión de
    // storage_path entre subidas rápidas).
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const path = `${session.company_id}/${installationId}/${category}-${ts}-${rand}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());

    // Garantizamos bucket vía helper compartido (idempotente, listBuckets +
    // createBucket si falta). Antes podía dar `Bucket not found` en prod.
    await ensureBucket(admin, PHOTO_BUCKET);

    // contentType: si el browser no envía MIME (Android viejo, ciertas
    // apps), inferimos por extensión. HEIC/HEIF se respeta tal cual.
    const contentType =
      file.type ||
      (ext === "heic" ? "image/heic" : ext === "heif" ? "image/heif" : "image/jpeg");
    const { error: upErr } = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(path, buf, {
        contentType,
        upsert: false,
        cacheControl: "3600",
      });
    if (upErr) {
      console.error("[uploadInstallationPhoto] storage upload failed:", upErr.message);
      return { ok: false, error: `Storage: ${upErr.message}` };
    }

    // Insert defensivo: si alguna columna opcional no existe en BD
    // (mime_type, size_bytes, uploaded_by) reintentamos quitándola.
    // Las columnas mínimas que SIEMPRE deben existir son
    // company_id, installation_id, category, storage_path.
    const fullPayload: Record<string, unknown> = {
      company_id: session.company_id,
      installation_id: installationId,
      category,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: session.user_id,
    };
    let row: {
      id: string;
      storage_path: string;
      category: string;
      caption: string | null;
      taken_at: string;
    } | null = null;
    let lastErr: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await admin
        .from("installation_photos")
        .insert(fullPayload)
        .select("id, storage_path, category, caption, taken_at")
        .single();
      if (!r.error) {
        row = r.data as typeof row;
        break;
      }
      const m = (r.error as { message?: string } | null)?.message ?? "";
      lastErr = m;
      // Detectar columna inexistente y eliminarla del payload
      const missing = m.match(/column "?([a-z_]+)"? .* does not exist/i);
      if (missing && missing[1] && missing[1] in fullPayload) {
        console.error(
          `[uploadInstallationPhoto] column ${missing[1]} missing, retrying without it`,
        );
        delete fullPayload[missing[1]];
        continue;
      }
      // Detectar columna en schema cache
      const cache = m.match(/'([a-z_]+)' column .* schema cache/i);
      if (cache && cache[1] && cache[1] in fullPayload) {
        console.error(
          `[uploadInstallationPhoto] column ${cache[1]} not in schema cache, retrying without it`,
        );
        delete fullPayload[cache[1]];
        continue;
      }
      // Otro tipo de error → no reintentamos
      break;
    }
    if (!row) {
      console.error("[uploadInstallationPhoto] insert installation_photos failed:", lastErr);
      return { ok: false, error: `BD: ${lastErr ?? "no se pudo guardar la foto"}` };
    }

    let signedUrl: string | null = null;
    try {
      const { data: signed, error: sErr } = await admin.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(path, 3600);
      if (sErr) {
        console.error("[uploadInstallationPhoto] createSignedUrl failed:", sErr.message);
      }
      signedUrl = (signed as { signedUrl: string } | null)?.signedUrl ?? null;
    } catch (e) {
      console.error("[uploadInstallationPhoto] createSignedUrl threw:", e);
    }

    revalidatePath(`/instalaciones/${installationId}`);
    const r = row as {
      id: string;
      storage_path: string;
      category: string;
      caption: string | null;
      taken_at: string;
    };
    return { ok: true, photo: { ...r, signed_url: signedUrl } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

type SignatureResult = { ok: true } | { ok: false; error: string };

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
}): Promise<SignatureResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // SEGURIDAD: admin salta RLS → verificar que la instalación es de tu empresa.
    await assertInstallationCompany(input.installation_id, session.company_id);
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

    // Intentos con fallbacks defensivos:
    //  1) Tal cual.
    //  2) Si signature_data_url no existe → quitar.
    //  3) Si CHECK constraint sobre context rechaza el valor → context=null.
    //  4) Si CHECK persiste → quitar context del payload.
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await admin.from("installation_signatures").insert(payload);
      if (!r.error) {
        revalidatePath(`/instalaciones/${input.installation_id}`);
        return { ok: true };
      }
      const msg = r.error.message ?? "";
      if (/signature_data_url/i.test(msg) && "signature_data_url" in payload) {
        console.error("[saveSignature] signature_data_url col missing, retrying without");
        delete payload.signature_data_url;
        continue;
      }
      if (/installation_signatures_context_check|context_check|violates check constraint/i.test(msg)) {
        if (payload.context !== null) {
          console.error(
            "[saveSignature] context value rejected by CHECK, retrying with null:",
            payload.context,
          );
          payload.context = null;
          continue;
        }
        // Ya estamos con null y aún rechaza → quitar la columna entera
        console.error("[saveSignature] context col rejected even null, dropping column");
        delete payload.context;
        continue;
      }
      console.error("[saveSignature] insert failed:", msg);
      return { ok: false, error: msg };
    }
    return {
      ok: false,
      error: "No se pudo guardar la firma tras varios reintentos",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Devuelve las firmas con la data URL para mostrarlas en el wizard.
 */
export async function listInstallationSignaturesFull(
  installationId: string,
): Promise<InstallationSignature[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin salta RLS → filtrar por company_id (firmas con DNI).
  let r = await admin
    .from("installation_signatures")
    .select(
      "id, signer_role, signer_name, signer_tax_id, context, signed_at, signature_data_url",
    )
    .eq("installation_id", installationId)
    .eq("company_id", session.company_id)
    .order("signed_at");
  if (r.error && /signature_data_url/i.test(r.error.message ?? "")) {
    r = await admin
      .from("installation_signatures")
      .select("id, signer_role, signer_name, signer_tax_id, context, signed_at")
      .eq("installation_id", installationId)
      .eq("company_id", session.company_id)
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
  let companyId: string | null = null;
  try {
    const session = await requireSession();
    companyId = session.company_id;
  } catch {
    return [];
  }
  if (!companyId) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let rows: Array<{
    id: string;
    storage_path: string;
    category: string;
    caption: string | null;
    taken_at: string;
  }> = [];
  try {
    // SEGURIDAD: admin salta RLS → filtrar por company_id.
    const { data } = await admin
      .from("installation_photos")
      .select("id, storage_path, category, caption, taken_at")
      .eq("installation_id", installationId)
      .eq("company_id", companyId)
      .order("taken_at", { ascending: false });
    rows = (data ?? []) as typeof rows;
  } catch {
    return [];
  }
  const out: InstallationPhoto[] = [];
  for (const r of rows) {
    let signedUrl: string | null = null;
    try {
      const { data } = await admin.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(r.storage_path, 3600);
      signedUrl = (data as { signedUrl: string } | null)?.signedUrl ?? null;
    } catch {
      /* bucket puede no existir → signedUrl queda null */
    }
    out.push({ ...r, signed_url: signedUrl });
  }
  return out;
}

// Bucket SIG_BUCKET reservado para futura subida de imágenes (hoy
// guardamos data URL inline). Lo definimos para que el linter no
// se queje del const sin usar y para documentar la intención.
void SIG_BUCKET;
