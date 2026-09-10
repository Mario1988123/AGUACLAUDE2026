"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { FISCAL_DEFAULTS, loadFiscalSettings } from "./load";
import type { FiscalSettings } from "./load";

// El tipo y los defaults viven en ./load (módulo normal): este fichero es
// "use server" y todo lo que exporte sería una server action invocable desde
// el navegador, así que aquí no puede haber nada que acepte un company_id.
export type { FiscalSettings } from "./load";

const DEFAULTS = FISCAL_DEFAULTS;

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getFiscalSettings(): Promise<FiscalSettings> {
  try {
    const session = await requireSession();
    if (!session.company_id) return DEFAULTS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    return await loadFiscalSettings(admin, session.company_id);
  } catch {
    return DEFAULTS;
  }
}

/**
 * Persiste la configuración fiscal de la empresa con UPSERT atómico
 * + verificación post-write. Si tras escribir el SELECT no devuelve
 * los valores enviados, lanza error explícito (algo intermedio está
 * pisando los datos: trigger, schema cache, RLS, etc.).
 *
 * Si una columna no existe en BD, la quita y reintenta para guardar
 * lo demás, y avisa al usuario qué quedó fuera.
 */
/** Validación de formato de los campos críticos antes de persistir.
 *  Lanza Error con mensaje legible si algo no cumple. */
function validateFiscalFormat(input: Partial<FiscalSettings>): void {
  // Decisión usuario 2026-05-11: NO validar CIF ni IBAN en fiscal. El admin
  // se hace responsable de meter sus propios datos correctos. Las
  // validaciones automáticas estaban dando falsos positivos que bloqueaban
  // a usuarios legítimos. Solo se valida lo trivial (email mal formado).
  const errs: string[] = [];

  if (input.fiscal_email != null && input.fiscal_email !== "") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.fiscal_email)) {
      errs.push("Email con formato inválido");
    }
  }

  if (errs.length > 0) {
    throw new Error(errs.join(" · "));
  }
}

export async function updateFiscalSettingsAction(
  input: Partial<FiscalSettings>,
): Promise<{ saved: Partial<FiscalSettings>; skipped: string[] }> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  validateFiscalFormat(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Trabajamos sobre una copia mutable del payload
  const payload: Record<string, unknown> = {
    company_id: session.company_id,
    ...input,
  };
  const skipped: string[] = [];

  // UPSERT con onConflict = company_id. Más robusto que SELECT-then-
  // INSERT/UPDATE: evita race conditions y sortea casos donde el
  // SELECT devuelve null por schema cache pero la fila SÍ existe
  // (haciendo que el INSERT tirara por unique constraint).
  for (let i = 0; i < 30; i++) {
    const r = await admin
      .from("company_settings")
      .upsert(payload, { onConflict: "company_id" });
    if (!r.error) break;
    const msg = r.error.message ?? "";
    console.error(`[updateFiscal] upsert attempt ${i} error:`, msg);
    const m =
      msg.match(/column "?([a-z_]+)"? .* does not exist/i) ??
      msg.match(/'([a-z_]+)' column .* schema cache/i) ??
      msg.match(/Could not find the '([a-z_]+)' column/i);
    if (m && m[1] && m[1] in payload && m[1] !== "company_id") {
      skipped.push(m[1]);
      delete payload[m[1]];
      continue;
    }
    throw new Error(`No se pudo guardar: ${msg}`);
  }

  // Verificación post-write: leemos lo que quedó realmente en BD
  // y comparamos con los campos significativos enviados. Si algo
  // que enviamos NO está en la BD tras el upsert, lanzamos error
  // explícito en vez de mentirle al usuario.
  const requested = Object.keys(input).filter((k) => k !== "company_id");
  const { data: verify, error: vErr } = await admin
    .from("company_settings")
    .select(requested.join(", "))
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (vErr) {
    console.error("[updateFiscal] verify SELECT failed:", vErr.message);
  } else if (verify && requested.length > 0) {
    const v = verify as Record<string, unknown>;
    const mismatched: string[] = [];
    for (const k of requested) {
      if (skipped.includes(k)) continue;
      const sent = (input as Record<string, unknown>)[k];
      const got = v[k];
      // Normalizamos null vs "" porque el form puede enviar "" pero la
      // BD lo guarda como NULL.
      const norm = (x: unknown) =>
        x === "" || x === undefined ? null : x;
      if (JSON.stringify(norm(sent)) !== JSON.stringify(norm(got))) {
        console.error(
          `[updateFiscal] mismatch ${k}: sent=`,
          sent,
          "got=",
          got,
        );
        mismatched.push(k);
      }
    }
    if (mismatched.length > 0) {
      throw new Error(
        `Algunos campos no se persistieron correctamente: ${mismatched.join(", ")}. Posible trigger o schema cache. Avisa al admin.`,
      );
    }
  }

  if (skipped.length > 0) {
    throw new Error(
      `Datos guardados parcialmente. Columnas inexistentes en BD: ${skipped.join(", ")}.`,
    );
  }

  revalidatePath("/configuracion/fiscal");
  return { saved: payload as Partial<FiscalSettings>, skipped };
}

/**
 * Sube el logo de la empresa al bucket `company-logos` y devuelve la URL
 * pública. Restricciones (validadas en cliente Y en servidor):
 *  - Tipos aceptados: PNG, JPG, WEBP, SVG.
 *  - Tamaño máximo: 1 MB (suficiente para un logo bien optimizado).
 *  - Dimensión recomendada: ancho 600-1200 px (≈4-6 cm a 300 dpi). El
 *    PDF lo escala manteniendo aspect-ratio; un logo más grande malgasta
 *    espacio sin mejorar la calidad de impresión.
 *
 * Devuelve `{ url }` con la URL pública lista para guardar en
 * `fiscal_logo_url`. El form llama después a `updateFiscalSettingsAction`
 * para persistir esa URL.
 */
const MAX_LOGO_BYTES = 1 * 1024 * 1024; // 1 MB
const ALLOWED_LOGO_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
]);

export async function uploadCompanyLogoAction(input: {
  /** Data URL "data:image/png;base64,..." */
  data_url: string;
  /** Nombre original (para extraer extensión si no viene en el data url). */
  original_filename?: string | null;
}): Promise<{ url: string }> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!input.data_url?.startsWith("data:image/")) {
    throw new Error("El archivo no es una imagen válida.");
  }
  const match = input.data_url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("Formato del archivo inesperado.");
  const mime = match[1]!.toLowerCase();
  if (!ALLOWED_LOGO_MIME.has(mime)) {
    throw new Error(
      `Tipo no soportado (${mime}). Usa PNG, JPG, WEBP o SVG.`,
    );
  }
  const buffer = Buffer.from(match[2]!, "base64");
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new Error(
      `El logo supera 1 MB (${(buffer.length / 1024 / 1024).toFixed(2)} MB). Comprímelo antes de subirlo.`,
    );
  }

  const { ensureBucket } = await import("@/shared/lib/supabase/storage-buckets");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const BUCKET = "company-logos";
  const ok = await ensureBucket(admin, BUCKET);
  if (!ok) throw new Error("No se pudo preparar el bucket de logos.");

  const ext =
    mime === "image/svg+xml"
      ? "svg"
      : mime === "image/png"
        ? "png"
        : mime === "image/webp"
          ? "webp"
          : "jpg";
  // Path estable + cache-buster: la URL pública nueva invalida la antigua
  // sin tener que borrar el fichero anterior.
  const path = `${session.company_id}/logo-${Date.now()}.${ext}`;
  const up = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: true,
    cacheControl: "3600",
  });
  if (up.error) throw new Error(`No se pudo subir el logo: ${up.error.message}`);

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = (data as { publicUrl: string }).publicUrl;
  if (!publicUrl) throw new Error("No se pudo generar la URL pública del logo.");

  revalidatePath("/configuracion/fiscal");
  return { url: publicUrl };
}

export async function updateFiscalSettingsSafeAction(
  v: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateFiscalSettingsAction(v as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function uploadCompanyLogoSafeAction(input: {
  data_url: string;
  original_filename?: string | null;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const r = await uploadCompanyLogoAction(input);
    return { ok: true, url: r.url };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
