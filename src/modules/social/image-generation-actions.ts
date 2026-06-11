"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { ensureBucket } from "@/shared/lib/supabase/storage-buckets";
import { buildEnrichedImagePrompt } from "./image-prompt-builder";
import {
  generateImageWithGemini,
  type GeminiReferenceImage,
} from "./gemini-client";
// NOTA: image-overlay.ts (sharp + Pango) ya NO se usa. El overlay (logo + texto)
// se aplica ahora en el cliente con HTML5 Canvas (overlay-canvas.tsx), porque
// en Vercel/Lambda no hay fuentes instaladas y Pango devolvía cuadrados (□□□).
// El archivo se mantiene por si en el futuro se necesita un fallback server.
import type {
  ImageOverrides,
  ImageProvider,
  ImageStyle,
  ImageVisualSettings,
  OverlayPosition,
  PostForPromptBuilder,
  ProductReference,
  ResolvedOverlaySettings,
  WatermarkPosition,
} from "./image-types";

const BUCKET = "social-images";
const COST_PER_IMAGE_CENTS = 4;
const MAX_PRODUCTS_PER_POST = 4; // tope sano para no inflar el prompt ni Gemini

/**
 * Construye el prompt enriquecido SIN llamar a la IA. Útil para que el
 * panel muestre al admin lo que se va a mandar ANTES de gastar imagen.
 *
 * Acepta overrides y product_ids opcionales para previsualizar exactamente
 * lo mismo que se enviaría al pulsar "Generar".
 */
export async function previewEnrichedPromptAction(
  postId: string,
  promptOverride?: string,
  overrides?: ImageOverrides | null,
  productIds?: string[] | null,
): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const ctx = await loadContext(
      admin,
      postId,
      session.company_id,
      productIds ?? null,
    );
    if (ctx.err) return { ok: false, error: ctx.err };

    const postForBuilder: PostForPromptBuilder = {
      ...ctx.post!,
      image_prompt: promptOverride?.trim() || ctx.post!.image_prompt,
      product_refs: ctx.products,
    };
    const prompt = buildEnrichedImagePrompt(
      postForBuilder,
      ctx.settings!,
      ctx.companyName,
      overrides ?? null,
    );
    return { ok: true, prompt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Genera la imagen del post llamando al proveedor IA configurado, sube a
 * Storage y persiste image_url + metadata + coste en social_posts.
 *
 * Pipeline:
 *   1) Cargar contexto (post, settings, productos seleccionados, logo).
 *   2) Validar cap mensual (sin llamar al proveedor).
 *   3) Descargar fotos de productos (paralelo) para enviar como referencia.
 *   4) Construir prompt enriquecido (defaults + overrides + productos).
 *   5) Llamar Gemini.
 *   6) Aplicar overlay (logo + texto) si está habilitado.
 *   7) Subir bytes a Storage y persistir todo.
 */
export async function generatePostImageAction(
  postId: string,
  promptOverride?: string,
  overrides?: ImageOverrides | null,
  productIds?: string[] | null,
): Promise<
  | {
      ok: true;
      image_url: string;
      prompt_used: string;
      cost_cents: number;
      images_used: number;
      budget_cents: number;
      /** URL pública del logo de la empresa para que el cliente lo dibuje en canvas. */
      logo_url: string | null;
      /** Settings de overlay resueltos (defaults + overrides). El cliente los aplica. */
      resolved_overlay: ResolvedOverlaySettings;
    }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) return { ok: false, error: "Sin permisos" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Validar tope de productos seleccionados.
    const safeProductIds = (productIds ?? []).slice(0, MAX_PRODUCTS_PER_POST);

    const ctx = await loadContext(
      admin,
      postId,
      session.company_id,
      safeProductIds,
    );
    if (ctx.err) return { ok: false, error: ctx.err };

    if (ctx.settings!.image_provider === "none") {
      return {
        ok: false,
        error:
          "No hay proveedor de imagen IA configurado. Ve a /configuracion/rrss y elige Gemini.",
      };
    }

    // ── Cap mensual ──────────────────────────────────────────────────────────
    const today = new Date();
    const periodStart = ctx.settings!.images_used_period_start
      ? new Date(ctx.settings!.images_used_period_start)
      : null;
    let imagesUsed = ctx.settings!.images_used_this_month ?? 0;
    let currentPeriodStart = ctx.settings!.images_used_period_start;
    if (
      !periodStart ||
      periodStart.getUTCFullYear() !== today.getUTCFullYear() ||
      periodStart.getUTCMonth() !== today.getUTCMonth()
    ) {
      imagesUsed = 0;
      currentPeriodStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
      )
        .toISOString()
        .slice(0, 10);
    }
    const budgetCents = ctx.settings!.monthly_image_budget_cents ?? 500;
    if ((imagesUsed + 1) * COST_PER_IMAGE_CENTS > budgetCents) {
      return {
        ok: false,
        error: `Alcanzaste el presupuesto mensual de imágenes IA (${
          budgetCents / 100
        } €). Sube el presupuesto en /configuracion/rrss o espera al próximo mes.`,
      };
    }

    // ── Descargar fotos de productos en paralelo ─────────────────────────────
    const referenceImages = await downloadProductPhotos(ctx.products);

    // ── Construir prompt enriquecido (con overrides + productos) ─────────────
    const postForBuilder: PostForPromptBuilder = {
      ...ctx.post!,
      image_prompt: promptOverride?.trim() || ctx.post!.image_prompt,
      product_refs: ctx.products,
    };
    const finalPrompt = buildEnrichedImagePrompt(
      postForBuilder,
      ctx.settings!,
      ctx.companyName,
      overrides ?? null,
    );

    // ── Llamar a Gemini ──────────────────────────────────────────────────────
    const gen = await generateImageWithGemini(finalPrompt, referenceImages);
    if (!gen.ok || !gen.image_bytes) {
      return {
        ok: false,
        error: gen.error_message ?? gen.error_code ?? "Error generando imagen",
      };
    }

    // ── Settings de overlay (los devolvemos al cliente; NO se aplican aquí) ──
    const resolvedOverlay = resolveOverlaySettings(
      ctx.settings!,
      overrides ?? null,
      ctx.fiscalLogoUrl,
    );

    // ── Subir imagen "raw" (sin overlay) a Storage ───────────────────────────
    // El cliente añadirá logo/texto en su canvas y luego llamará a
    // saveFinalPostImageAction con el PNG ya compuesto.
    const bucketReady = await ensureBucket(admin, BUCKET);
    if (!bucketReady) {
      return {
        ok: false,
        error: "No se pudo crear el bucket de Storage social-images.",
      };
    }
    const finalMime = gen.mime_type ?? "image/png";
    const ext = finalMime.includes("jpeg") ? "jpg" : "png";
    const objectPath = `${session.company_id}/${postId}-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(objectPath, gen.image_bytes, {
        contentType: finalMime,
        upsert: true,
      });
    if (upErr) {
      return {
        ok: false,
        error: `Fallo al subir imagen a Storage: ${upErr.message}`,
      };
    }
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath);
    const imageUrl = pub.publicUrl;

    // ── Persistir post + overrides + product_ids + metadata ──────────────────
    const enrichedMetadata = {
      ...gen.metadata,
      overlay_applied: false, // el cliente lo marcará a true cuando guarde la final
      product_ids: safeProductIds,
    };
    await admin
      .from("social_posts")
      .update({
        image_url: imageUrl,
        image_prompt_final: finalPrompt,
        image_generation_metadata: enrichedMetadata,
        image_generation_cost_cents: COST_PER_IMAGE_CENTS,
        image_generated_at: new Date().toISOString(),
        image_overrides: overrides ?? null,
        product_ids: safeProductIds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .eq("company_id", session.company_id);

    await admin
      .from("social_settings")
      .update({
        images_used_this_month: imagesUsed + 1,
        images_used_period_start: currentPeriodStart,
      })
      .eq("company_id", session.company_id);

    // Convertimos el logo a dataURL PNG. Cubre tres problemas a la vez:
    //   1) CORS al cargarlo en canvas (las dataURL no necesitan CORS)
    //   2) SVG (canvas tiene problemas con SVG vía Image; sharp lo rasteriza)
    //   3) Tamaño/optimización (sharp limita ancho razonable)
    const logoDataUrl = await fetchLogoAsDataUrl(ctx.fiscalLogoUrl);

    revalidatePath(`/rrss/posts/${postId}`);
    return {
      ok: true,
      image_url: imageUrl,
      prompt_used: finalPrompt,
      cost_cents: COST_PER_IMAGE_CENTS,
      images_used: imagesUsed + 1,
      budget_cents: budgetCents,
      logo_url: logoDataUrl,
      resolved_overlay: resolvedOverlay,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Descarga el logo de empresa, lo rasteriza a PNG con sharp y lo devuelve
 * como data URL listo para meter en `<img>` o canvas SIN problemas de CORS
 * ni de formato SVG. Si falla en cualquier paso → devuelve null y el editor
 * mostrará el toggle de logo deshabilitado.
 *
 * Límite de ancho 600 px: suficiente para overlay de hasta 30 % del ancho
 * de la imagen IA (1024 px). Mantiene aspect ratio.
 */
async function fetchLogoAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const png = await sharp(buf, { density: 300 })
      .resize({ width: 600, withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

interface LoadedContext {
  post: (PostForPromptBuilder & { company_id: string }) | null;
  settings: ImageVisualSettings | null;
  companyName: string;
  fiscalLogoUrl: string | null;
  products: ProductReference[];
  err?: string;
}

/**
 * Carga post + settings + nombre empresa + logo + productos seleccionados.
 * Defensive: si una columna nueva aún no existe en BD (migración no aplicada),
 * el campo cae a un valor sensible.
 */
async function loadContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  postId: string,
  companyId: string,
  productIds: string[] | null,
): Promise<LoadedContext> {
  const empty: LoadedContext = {
    post: null,
    settings: null,
    companyName: "",
    fiscalLogoUrl: null,
    products: [],
  };

  const { data: postData } = await admin
    .from("social_posts")
    .select(
      "id, company_id, topic, content_type, channel, target_segment, image_prompt, image_format",
    )
    .eq("id", postId)
    .maybeSingle();
  if (!postData) return { ...empty, err: "Post no encontrado" };
  if ((postData as { company_id: string }).company_id !== companyId) {
    return { ...empty, err: "Post de otra empresa" };
  }
  const post = postData as PostForPromptBuilder & { company_id: string };

  const { data: settingsRow } = await admin
    .from("social_settings")
    .select(
      `image_provider, image_style, brand_palette_primary,
       brand_palette_secondary, brand_palette_accent, brand_visual_keywords,
       brand_location_hint, forbidden_visual_elements, preferred_visual_elements,
       monthly_image_budget_cents, images_used_this_month, images_used_period_start,
       logo_overlay_enabled_default, logo_position_default, logo_size_pct_default,
       watermark_text_enabled_default, watermark_text_default,
       watermark_text_position_default, watermark_text_color_default`,
    )
    .eq("company_id", companyId)
    .maybeSingle();
  const s = settingsRow as Record<string, unknown> | null;
  const settings: ImageVisualSettings = {
    image_provider: ((s?.image_provider as ImageProvider) ?? "none") as ImageProvider,
    image_style: ((s?.image_style as ImageStyle | null) ?? "editorial") as ImageStyle,
    brand_palette_primary: (s?.brand_palette_primary as string | null) ?? null,
    brand_palette_secondary: (s?.brand_palette_secondary as string | null) ?? null,
    brand_palette_accent: (s?.brand_palette_accent as string | null) ?? null,
    brand_visual_keywords: (s?.brand_visual_keywords as string | null) ?? null,
    brand_location_hint: (s?.brand_location_hint as string | null) ?? null,
    forbidden_visual_elements:
      (s?.forbidden_visual_elements as string[] | null) ?? [],
    preferred_visual_elements:
      (s?.preferred_visual_elements as string[] | null) ?? [],
    monthly_image_budget_cents:
      (s?.monthly_image_budget_cents as number | null) ?? 500,
    images_used_this_month: (s?.images_used_this_month as number | null) ?? 0,
    images_used_period_start:
      (s?.images_used_period_start as string | null) ?? null,
    logo_overlay_enabled_default:
      (s?.logo_overlay_enabled_default as boolean | null) ?? true,
    logo_position_default:
      ((s?.logo_position_default as OverlayPosition | null) ??
        "bottom-right") as OverlayPosition,
    logo_size_pct_default: (s?.logo_size_pct_default as number | null) ?? 12,
    watermark_text_enabled_default:
      (s?.watermark_text_enabled_default as boolean | null) ?? false,
    watermark_text_default: (s?.watermark_text_default as string | null) ?? null,
    watermark_text_position_default:
      ((s?.watermark_text_position_default as WatermarkPosition | null) ??
        "bottom-center") as WatermarkPosition,
    watermark_text_color_default:
      (s?.watermark_text_color_default as string | null) ?? "#FFFFFF",
  };

  // Nombre comercial + logo de empresa (vivien en company_settings, módulo fiscal).
  let companyName = "tu empresa";
  let fiscalLogoUrl: string | null = null;
  try {
    const { data: cs } = await admin
      .from("company_settings")
      .select("fiscal_trade_name, fiscal_legal_name, fiscal_logo_url")
      .eq("company_id", companyId)
      .maybeSingle();
    const csRow = cs as
      | {
          fiscal_trade_name?: string | null;
          fiscal_legal_name?: string | null;
          fiscal_logo_url?: string | null;
        }
      | null;
    companyName =
      csRow?.fiscal_trade_name || csRow?.fiscal_legal_name || companyName;
    fiscalLogoUrl = csRow?.fiscal_logo_url ?? null;
    if (companyName === "tu empresa") {
      const { data: c } = await admin
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      companyName = (c as { name?: string | null } | null)?.name ?? companyName;
    }
  } catch {
    /* fallback al genérico */
  }

  // Cargar productos seleccionados (si los hay) con foto.
  let products: ProductReference[] = [];
  if (productIds && productIds.length > 0) {
    try {
      const { data: prodRows } = await admin
        .from("products")
        .select("id, name, description, main_image_url")
        .eq("company_id", companyId) // seguridad: nunca productos de otra empresa
        .in("id", productIds.slice(0, MAX_PRODUCTS_PER_POST));
      products = ((prodRows as ProductReference[] | null) ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        main_image_url: p.main_image_url ?? null,
      }));
    } catch {
      /* productos opcionales — si falla la query, seguimos sin ellos */
    }
  }

  return { post, settings, companyName, fiscalLogoUrl, products };
}

/**
 * Descarga fotos de los productos para enviarlas a Gemini como referencia
 * visual. Tolerante: si una falla, sigue con las demás. Limita a JPG/PNG/WebP.
 */
async function downloadProductPhotos(
  products: ProductReference[],
): Promise<GeminiReferenceImage[]> {
  const photoUrls = products
    .map((p) => p.main_image_url)
    .filter((u): u is string => !!u);
  if (photoUrls.length === 0) return [];

  const results = await Promise.allSettled(
    photoUrls.map(async (url): Promise<GeminiReferenceImage> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") ?? "image/jpeg";
      const mime = ct.startsWith("image/") ? ct.split(";")[0]!.trim() : "image/jpeg";
      const data = Buffer.from(await res.arrayBuffer());
      return { data, mimeType: mime };
    }),
  );
  const fulfilled: GeminiReferenceImage[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") fulfilled.push(r.value);
  }
  return fulfilled;
}

/** Mezcla defaults + overrides + logo URL real → settings resueltos de overlay. */
function resolveOverlaySettings(
  defaults: ImageVisualSettings,
  overrides: ImageOverrides | null,
  logoUrl: string | null,
): ResolvedOverlaySettings {
  const logoEnabled =
    overrides?.logo_overlay_enabled ?? defaults.logo_overlay_enabled_default;
  const wmEnabled =
    overrides?.watermark_text_enabled ?? defaults.watermark_text_enabled_default;
  const wmText = overrides?.watermark_text ?? defaults.watermark_text_default;
  return {
    logo_enabled: logoEnabled && !!logoUrl,
    logo_url: logoUrl,
    logo_position: (overrides?.logo_position ??
      defaults.logo_position_default) as OverlayPosition,
    logo_size_pct: overrides?.logo_size_pct ?? defaults.logo_size_pct_default,
    watermark_text_enabled: wmEnabled && !!wmText && wmText.trim().length > 0,
    watermark_text: wmText ?? null,
    watermark_text_position: (overrides?.watermark_text_position ??
      defaults.watermark_text_position_default) as WatermarkPosition,
    watermark_text_color:
      overrides?.watermark_text_color ?? defaults.watermark_text_color_default,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// saveFinalPostImageAction
//
// El cliente compone la imagen final (imagen IA + logo + texto) en un canvas
// y la manda aquí como dataURL "data:image/png;base64,...". La subimos a
// Storage sustituyendo la imagen "raw" anterior y marcamos overlay_applied=true.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PNG_BYTES = 8 * 1024 * 1024; // 8 MB de imagen final

export async function saveFinalPostImageAction(
  postId: string,
  pngDataUrl: string,
  flags: { logo_applied: boolean; text_applied: boolean },
): Promise<{ ok: true; image_url: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) return { ok: false, error: "Sin permisos" };

    // Validar formato dataURL
    const m = pngDataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!m) return { ok: false, error: "Formato de imagen inválido (debe ser PNG)" };
    const buf = Buffer.from(m[1]!, "base64");
    if (buf.byteLength > MAX_PNG_BYTES) {
      return { ok: false, error: "Imagen demasiado grande (máx. 8 MB)" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Verificar que el post pertenece a la empresa (anti-IDOR).
    const { data: postRow } = await admin
      .from("social_posts")
      .select("id, company_id, image_url, image_generation_metadata")
      .eq("id", postId)
      .maybeSingle();
    if (!postRow) return { ok: false, error: "Post no encontrado" };
    if ((postRow as { company_id: string }).company_id !== session.company_id) {
      return { ok: false, error: "Post de otra empresa" };
    }

    const bucketReady = await ensureBucket(admin, BUCKET);
    if (!bucketReady) {
      return { ok: false, error: "No se pudo preparar el bucket social-images" };
    }

    const objectPath = `${session.company_id}/${postId}-final-${Date.now()}.png`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(objectPath, buf, {
        contentType: "image/png",
        upsert: true,
      });
    if (upErr) {
      return { ok: false, error: `Fallo subiendo imagen final: ${upErr.message}` };
    }
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath);
    const imageUrl = pub.publicUrl;

    // Borrar la imagen raw previa (best-effort).
    try {
      const prevUrl = (postRow as { image_url?: string }).image_url ?? "";
      const prevKey = prevUrl.split(`/${BUCKET}/`)[1] ?? "";
      if (prevKey && !prevKey.endsWith("-final-" + objectPath.split("-final-")[1])) {
        await admin.storage.from(BUCKET).remove([prevKey]);
      }
    } catch {
      /* best-effort */
    }

    const prevMeta =
      ((postRow as { image_generation_metadata?: Record<string, unknown> })
        .image_generation_metadata as Record<string, unknown> | null) ?? {};
    const newMeta = {
      ...prevMeta,
      overlay_applied: flags.logo_applied || flags.text_applied,
      overlay_logo_applied: flags.logo_applied,
      overlay_text_applied: flags.text_applied,
    };

    await admin
      .from("social_posts")
      .update({
        image_url: imageUrl,
        image_generation_metadata: newMeta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .eq("company_id", session.company_id);

    revalidatePath(`/rrss/posts/${postId}`);
    return { ok: true, image_url: imageUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
