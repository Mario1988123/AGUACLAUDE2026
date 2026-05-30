"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import type {
  ImageProvider,
  ImageStyle,
  ImageVisualSettings,
  OverlayPosition,
  WatermarkPosition,
} from "./image-types";

async function ensureAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) {
    throw new Error("Solo el admin puede configurar la imagen IA de RRSS");
  }
  return session;
}

export async function getSocialImageSettings(): Promise<ImageVisualSettings> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
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
    .eq("company_id", session.company_id)
    .maybeSingle();
  const s = data as Record<string, unknown> | null;
  return {
    image_provider: ((s?.image_provider as ImageProvider) ?? "none") as ImageProvider,
    image_style:
      ((s?.image_style as ImageStyle | null) ?? "editorial") as ImageStyle,
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
}

const colorHexNullable = z
  .string()
  .nullish()
  .transform((v) => (v ? v.trim() : null))
  .refine(
    (v) => v === null || /^#?[0-9a-fA-F]{3,8}$/.test(v),
    "Color debe ser hex como #4880FF",
  )
  .transform((v) => (v && !v.startsWith("#") ? `#${v}` : v));

const overlayPositionEnum = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);
const watermarkPositionEnum = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "bottom-center",
]);

const saveSchema = z.object({
  image_provider: z.enum(["none", "gemini"]),
  image_style: z
    .enum(["photoreal", "flat", "illustration", "3d", "editorial", "minimalist"])
    .nullish(),
  brand_palette_primary: colorHexNullable,
  brand_palette_secondary: colorHexNullable,
  brand_palette_accent: colorHexNullable,
  brand_visual_keywords: z.string().trim().max(500).nullish(),
  brand_location_hint: z.string().trim().max(200).nullish(),
  forbidden_visual_elements: z.array(z.string().trim().min(1).max(120)).nullish(),
  preferred_visual_elements: z.array(z.string().trim().min(1).max(120)).nullish(),
  monthly_image_budget_cents: z.number().int().min(0).max(50000),
  // Defaults de marca de agua (opcionales — si vienen undefined, no se tocan)
  logo_overlay_enabled_default: z.boolean().nullish(),
  logo_position_default: overlayPositionEnum.nullish(),
  logo_size_pct_default: z.number().int().min(5).max(30).nullish(),
  watermark_text_enabled_default: z.boolean().nullish(),
  watermark_text_default: z.string().trim().max(80).nullish(),
  watermark_text_position_default: watermarkPositionEnum.nullish(),
  watermark_text_color_default: colorHexNullable,
});

export async function saveSocialImageSettingsAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    const parsed = parseOrFriendly(saveSchema, input, "Configuración imagen IA");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Sólo añadimos al payload las columnas nuevas si vienen definidas — para
    // evitar romper si la migración aún no se aplicó en algún entorno.
    const payload: Record<string, unknown> = {
      image_provider: parsed.image_provider,
      image_style: parsed.image_style ?? "editorial",
      brand_palette_primary: parsed.brand_palette_primary,
      brand_palette_secondary: parsed.brand_palette_secondary,
      brand_palette_accent: parsed.brand_palette_accent,
      brand_visual_keywords: parsed.brand_visual_keywords ?? null,
      brand_location_hint: parsed.brand_location_hint ?? null,
      forbidden_visual_elements: parsed.forbidden_visual_elements ?? [],
      preferred_visual_elements: parsed.preferred_visual_elements ?? [],
      monthly_image_budget_cents: parsed.monthly_image_budget_cents,
    };
    if (parsed.logo_overlay_enabled_default !== undefined && parsed.logo_overlay_enabled_default !== null) {
      payload.logo_overlay_enabled_default = parsed.logo_overlay_enabled_default;
    }
    if (parsed.logo_position_default) payload.logo_position_default = parsed.logo_position_default;
    if (parsed.logo_size_pct_default !== undefined && parsed.logo_size_pct_default !== null) {
      payload.logo_size_pct_default = parsed.logo_size_pct_default;
    }
    if (parsed.watermark_text_enabled_default !== undefined && parsed.watermark_text_enabled_default !== null) {
      payload.watermark_text_enabled_default = parsed.watermark_text_enabled_default;
    }
    if (parsed.watermark_text_default !== undefined) {
      payload.watermark_text_default = parsed.watermark_text_default || null;
    }
    if (parsed.watermark_text_position_default) {
      payload.watermark_text_position_default = parsed.watermark_text_position_default;
    }
    if (parsed.watermark_text_color_default) {
      payload.watermark_text_color_default = parsed.watermark_text_color_default;
    }

    const { data: existing } = await admin
      .from("social_settings")
      .select("company_id")
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (existing) {
      const { error } = await admin
        .from("social_settings")
        .update(payload)
        .eq("company_id", session.company_id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await admin
        .from("social_settings")
        .insert({ company_id: session.company_id, ...payload });
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath("/configuracion/rrss");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
