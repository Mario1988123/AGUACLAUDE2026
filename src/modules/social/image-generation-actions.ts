"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { ensureBucket } from "@/shared/lib/supabase/storage-buckets";
import { buildEnrichedImagePrompt } from "./image-prompt-builder";
import { generateImageWithGemini } from "./gemini-client";
import type {
  ImageVisualSettings,
  PostForPromptBuilder,
  ImageProvider,
  ImageStyle,
} from "./image-types";

const BUCKET = "social-images";

/**
 * Construye el prompt enriquecido SIN llamar a la IA. Útil para que el
 * panel muestre al admin lo que se va a mandar ANTES de gastar imagen.
 */
export async function previewEnrichedPromptAction(
  postId: string,
  promptOverride?: string,
): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { post, settings, companyName, err } = await loadContext(
      admin,
      postId,
      session.company_id,
    );
    if (err) return { ok: false, error: err };

    // Si el admin escribió override sobre el image_prompt base, lo usamos
    // como punto de partida (Capa 5 del plan: editar prompt antes de enviar).
    const postForBuilder: PostForPromptBuilder = {
      ...post!,
      image_prompt: promptOverride?.trim() || post!.image_prompt,
    };
    const prompt = buildEnrichedImagePrompt(
      postForBuilder,
      settings!,
      companyName,
    );
    return { ok: true, prompt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Genera la imagen del post llamando al proveedor IA configurado, sube a
 * Storage y persiste image_url + metadata + coste en social_posts. Cap
 * mensual aplicado: si la empresa alcanzó el budget, devuelve error claro
 * SIN llamar al proveedor (cero coste).
 */
export async function generatePostImageAction(
  postId: string,
  promptOverride?: string,
): Promise<
  | {
      ok: true;
      image_url: string;
      prompt_used: string;
      cost_cents: number;
      images_used: number;
      budget_cents: number;
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

    const { post, settings, companyName, err } = await loadContext(
      admin,
      postId,
      session.company_id,
    );
    if (err) return { ok: false, error: err };

    if (settings!.image_provider === "none") {
      return {
        ok: false,
        error:
          "No hay proveedor de imagen IA configurado. Ve a /configuracion/rrss y elige Gemini.",
      };
    }

    // Reset mensual del contador (si el periodo cambió).
    const today = new Date();
    const periodStart = settings!.images_used_period_start
      ? new Date(settings!.images_used_period_start)
      : null;
    let imagesUsed = settings!.images_used_this_month ?? 0;
    let currentPeriodStart = settings!.images_used_period_start;
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

    // Cap mensual: 1 imagen Gemini ≈ 4 céntimos → con 500 céntimos (default)
    // son ~125 imágenes/mes. Si el admin sube el budget, sube el cap.
    const budgetCents = settings!.monthly_image_budget_cents ?? 500;
    const costPerImage = 4;
    if ((imagesUsed + 1) * costPerImage > budgetCents) {
      return {
        ok: false,
        error: `Alcanzaste el presupuesto mensual de imágenes IA (${
          budgetCents / 100
        } €). Sube el presupuesto en /configuracion/rrss o espera al próximo mes.`,
      };
    }

    // Construir prompt enriquecido (admin puede haber editado el base).
    const postForBuilder: PostForPromptBuilder = {
      ...post!,
      image_prompt: promptOverride?.trim() || post!.image_prompt,
    };
    const finalPrompt = buildEnrichedImagePrompt(
      postForBuilder,
      settings!,
      companyName,
    );

    // Generar imagen.
    const gen = await generateImageWithGemini(finalPrompt);
    if (!gen.ok || !gen.image_bytes) {
      return {
        ok: false,
        error: gen.error_message ?? gen.error_code ?? "Error generando imagen",
      };
    }

    // Subir a Storage.
    const bucketReady = await ensureBucket(admin, BUCKET);
    if (!bucketReady) {
      return {
        ok: false,
        error: "No se pudo crear el bucket de Storage social-images.",
      };
    }
    const ext = (gen.mime_type ?? "image/png").includes("jpeg") ? "jpg" : "png";
    const objectPath = `${session.company_id}/${postId}-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(objectPath, gen.image_bytes, {
        contentType: gen.mime_type ?? "image/png",
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

    // Persistir en post + actualizar contador del cap.
    await admin
      .from("social_posts")
      .update({
        image_url: imageUrl,
        image_prompt_final: finalPrompt,
        image_generation_metadata: gen.metadata,
        image_generation_cost_cents: costPerImage,
        image_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);

    await admin
      .from("social_settings")
      .update({
        images_used_this_month: imagesUsed + 1,
        images_used_period_start: currentPeriodStart,
      })
      .eq("company_id", session.company_id);

    revalidatePath(`/rrss/posts/${postId}`);
    return {
      ok: true,
      image_url: imageUrl,
      prompt_used: finalPrompt,
      cost_cents: costPerImage,
      images_used: imagesUsed + 1,
      budget_cents: budgetCents,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/** Carga post + settings + nombre empresa + valida pertenencia. */
async function loadContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  postId: string,
  companyId: string,
): Promise<{
  post: PostForPromptBuilder | null;
  settings: ImageVisualSettings | null;
  companyName: string;
  err?: string;
}> {
  const { data: postData } = await admin
    .from("social_posts")
    .select(
      "id, company_id, topic, content_type, channel, target_segment, image_prompt, image_format",
    )
    .eq("id", postId)
    .maybeSingle();
  if (!postData) {
    return { post: null, settings: null, companyName: "", err: "Post no encontrado" };
  }
  if ((postData as { company_id: string }).company_id !== companyId) {
    return { post: null, settings: null, companyName: "", err: "Post de otra empresa" };
  }
  const post = postData as PostForPromptBuilder & { company_id: string };

  const { data: settingsRow } = await admin
    .from("social_settings")
    .select(
      `image_provider, image_style, brand_palette_primary,
       brand_palette_secondary, brand_palette_accent, brand_visual_keywords,
       brand_location_hint, forbidden_visual_elements, preferred_visual_elements,
       monthly_image_budget_cents, images_used_this_month, images_used_period_start`,
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
  };

  // Nombre comercial de la empresa para el prompt.
  let companyName = "tu empresa";
  try {
    const { data: cs } = await admin
      .from("company_settings")
      .select("fiscal_trade_name, fiscal_legal_name")
      .eq("company_id", companyId)
      .maybeSingle();
    companyName =
      (cs as { fiscal_trade_name?: string | null } | null)?.fiscal_trade_name ||
      (cs as { fiscal_legal_name?: string | null } | null)?.fiscal_legal_name ||
      companyName;
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

  return { post, settings, companyName };
}
