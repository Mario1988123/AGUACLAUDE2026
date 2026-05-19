"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface SocialSettings {
  company_id: string;
  brand_name: string | null;
  brand_hashtag: string | null;
  base_hashtags: string[];
  autonomous_mode: boolean;
  brand_voice: string | null;
  visual_style: string | null;
}

export async function getSocialSettings(): Promise<SocialSettings | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("social_settings")
    .select("company_id, brand_name, brand_hashtag, base_hashtags, autonomous_mode, brand_voice, visual_style")
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!data) {
    return {
      company_id: session.company_id,
      brand_name: null,
      brand_hashtag: null,
      base_hashtags: [],
      autonomous_mode: false,
      brand_voice: null,
      visual_style: null,
    };
  }
  return data as SocialSettings;
}

const schema = z.object({
  brand_name: z.string().trim().min(1).max(120),
  brand_hashtag: z.string().trim().max(60).nullish(),
  base_hashtags: z.array(z.string().trim().min(1)).max(20).default([]),
  autonomous_mode: z.boolean().default(false),
  brand_voice: z.string().trim().max(500).nullish(),
  visual_style: z.string().trim().max(500).nullish(),
});

export async function upsertSocialSettings(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin de empresa" };
    }
    const parsed = parseOrFriendly(schema, input, "Configuración RRSS");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      brand_name: parsed.brand_name,
      brand_hashtag: parsed.brand_hashtag ?? null,
      base_hashtags: parsed.base_hashtags,
      autonomous_mode: parsed.autonomous_mode,
      brand_voice: parsed.brand_voice ?? null,
      visual_style: parsed.visual_style ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin
      .from("social_settings")
      .upsert(payload, { onConflict: "company_id" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/rrss");
    revalidatePath("/configuracion/rrss");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
