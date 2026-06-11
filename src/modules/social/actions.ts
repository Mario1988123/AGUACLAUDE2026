"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface Ephemeris {
  id: string;
  slug: string;
  name: string;
  day_of_month: number;
  month_of_year: number;
  category: string;
  is_official: boolean;
  official_org: string | null;
  description: string | null;
  hashtags: string[];
  importance: "high" | "medium" | "low";
}

export interface SocialPost {
  id: string;
  scheduled_at: string;
  channel: string;
  content_type: string;
  ephemeris_id: string | null;
  campaign_id: string | null;
  campaign_phase: number | null;
  topic: string;
  copy_main: string;
  copy_short: string | null;
  copy_linkedin: string | null;
  cta: string | null;
  hashtags: string[];
  image_prompt: string | null;
  image_prompt_alt: string | null;
  image_url: string | null;
  image_alt_text: string | null;
  image_format: string | null;
  target_segment: string | null;
  intent_level: string;
  status: string;
  approved_at: string | null;
  published_at: string | null;
  seo_title: string | null;
  seo_meta_description: string | null;
  seo_excerpt: string | null;
  email_subject: string | null;
  reel_script: string | null;
  notes: string | null;
  review_notes: string | null;
  created_at: string;
}

/**
 * Lista todas las efemérides del catálogo (compartido entre empresas).
 * Ordenadas por mes+día para mostrar calendario anual.
 */
export async function listEphemerides(): Promise<Ephemeris[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("social_ephemerides")
    .select(
      "id, slug, name, day_of_month, month_of_year, category, is_official, official_org, description, hashtags, importance",
    )
    .order("month_of_year")
    .order("day_of_month");
  if (error) throw error;
  return (data ?? []) as Ephemeris[];
}

/**
 * Lista efemérides de un mes concreto, ordenadas por día.
 */
export async function listEphemeridesForMonth(month: number): Promise<Ephemeris[]> {
  const all = await listEphemerides();
  return all.filter((e) => e.month_of_year === month);
}

/**
 * Lista posts del calendario (filtros opcionales).
 */
export async function listSocialPosts(filters?: {
  status?: string;
  channel?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<SocialPost[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("social_posts")
    .select(
      "id, scheduled_at, channel, content_type, ephemeris_id, campaign_id, campaign_phase, topic, copy_main, copy_short, copy_linkedin, cta, hashtags, image_prompt, image_prompt_alt, image_url, image_alt_text, image_format, target_segment, intent_level, status, approved_at, published_at, seo_title, seo_meta_description, seo_excerpt, email_subject, reel_script, notes, review_notes, created_at",
    )
    .eq("company_id", session.company_id)
    .order("scheduled_at", { ascending: true })
    .limit(filters?.limit ?? 200);
  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.channel) q = q.eq("channel", filters.channel);
  if (filters?.from) q = q.gte("scheduled_at", filters.from);
  if (filters?.to) q = q.lte("scheduled_at", filters.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SocialPost[];
}

/**
 * Devuelve el post individual (para editor).
 */
export async function getSocialPost(id: string): Promise<SocialPost | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("social_posts")
    .select("*")
    .eq("id", id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  return (data as SocialPost | null) ?? null;
}

/**
 * Crea o actualiza un post. Si id presente → update; si no → insert.
 */
const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  scheduled_at: z.string(),
  channel: z.enum([
    "instagram",
    "facebook",
    "linkedin",
    "tiktok",
    "google_business",
    "blog",
    "newsletter",
  ]),
  content_type: z.enum([
    "educational",
    "ephemeris",
    "commercial_soft",
    "technical_authority",
    "local",
    "visual_reel",
  ]),
  ephemeris_id: z.string().uuid().nullish(),
  campaign_id: z.string().uuid().nullish(),
  campaign_phase: z.coerce.number().int().min(1).max(3).nullish(),
  topic: z.string().min(1),
  copy_main: z.string().min(1),
  copy_short: z.string().nullish(),
  copy_linkedin: z.string().nullish(),
  cta: z.string().nullish(),
  hashtags: z.array(z.string()).default([]),
  image_prompt: z.string().nullish(),
  image_prompt_alt: z.string().nullish(),
  image_url: z.string().nullish(),
  image_alt_text: z.string().nullish(),
  image_format: z.string().nullish(),
  target_segment: z.enum(["hogar", "empresa", "hosteleria", "comunidad", "administradores", "general"]).nullish(),
  intent_level: z.enum(["low", "medium", "high"]).default("low"),
  seo_title: z.string().nullish(),
  seo_meta_description: z.string().nullish(),
  seo_excerpt: z.string().nullish(),
  email_subject: z.string().nullish(),
  reel_script: z.string().nullish(),
  status: z.enum(["draft", "review", "approved", "published", "failed", "cancelled"]).default("draft"),
  notes: z.string().nullish(),
  review_notes: z.string().nullish(),
});

export async function upsertSocialPost(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(upsertSchema, input, "Publicación RRSS");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      scheduled_at: parsed.scheduled_at,
      channel: parsed.channel,
      content_type: parsed.content_type,
      ephemeris_id: parsed.ephemeris_id ?? null,
      campaign_id: parsed.campaign_id ?? null,
      campaign_phase: parsed.campaign_phase ?? null,
      topic: parsed.topic,
      copy_main: parsed.copy_main,
      copy_short: parsed.copy_short ?? null,
      copy_linkedin: parsed.copy_linkedin ?? null,
      cta: parsed.cta ?? null,
      hashtags: parsed.hashtags,
      image_prompt: parsed.image_prompt ?? null,
      image_prompt_alt: parsed.image_prompt_alt ?? null,
      image_url: parsed.image_url ?? null,
      image_alt_text: parsed.image_alt_text ?? null,
      image_format: parsed.image_format ?? "1080x1080",
      target_segment: parsed.target_segment ?? null,
      intent_level: parsed.intent_level,
      seo_title: parsed.seo_title ?? null,
      seo_meta_description: parsed.seo_meta_description ?? null,
      seo_excerpt: parsed.seo_excerpt ?? null,
      email_subject: parsed.email_subject ?? null,
      reel_script: parsed.reel_script ?? null,
      status: parsed.status,
      notes: parsed.notes ?? null,
      review_notes: parsed.review_notes ?? null,
      updated_at: new Date().toISOString(),
    };
    let id = parsed.id;
    if (id) {
      // SEGURIDAD: admin salta RLS → filtrar por company_id. Sin esto se podía
      // sobrescribir (y re-tenantear) un post de otra empresa con su UUID.
      const r = await admin
        .from("social_posts")
        .update(payload)
        .eq("id", id)
        .eq("company_id", session.company_id)
        .select("id");
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data?.length)
        return { ok: false, error: "Publicación no encontrada o no pertenece a tu empresa" };
    } else {
      payload.created_by = session.user_id;
      const r = await admin.from("social_posts").insert(payload).select("id").single();
      if (r.error) return { ok: false, error: r.error.message };
      id = (r.data as { id: string }).id;
    }
    revalidatePath("/rrss");
    revalidatePath("/rrss/posts");
    return { ok: true, id: id! };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function changePostStatus(
  postId: string,
  newStatus: "draft" | "review" | "approved" | "published" | "cancelled",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const updates: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === "approved") {
      updates.approved_at = new Date().toISOString();
      updates.approved_by = session.user_id;
    } else if (newStatus === "published") {
      updates.published_at = new Date().toISOString();
    }
    const r = await admin
      .from("social_posts")
      .update(updates)
      .eq("id", postId)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/rrss");
    revalidatePath("/rrss/posts");
    revalidatePath(`/rrss/posts/${postId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteSocialPost(
  postId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("social_posts")
      .delete()
      .eq("id", postId)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/rrss");
    revalidatePath("/rrss/posts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
