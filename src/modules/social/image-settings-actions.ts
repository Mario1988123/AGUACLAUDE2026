"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import type { ImageProvider, ImageStyle, ImageVisualSettings } from "./image-types";

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
       monthly_image_budget_cents, images_used_this_month, images_used_period_start`,
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
});

export async function saveSocialImageSettingsAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    const parsed = parseOrFriendly(saveSchema, input, "Configuración imagen IA");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const payload = {
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
