"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface LegalNoticeRow {
  id: string;
  boe_id: string | null;
  boe_date: string | null;
  title: string;
  url: string | null;
  keywords_matched: string | null;
  fetched_at: string;
  reviewed_at: string | null;
  dismissed_at: string | null;
}

async function ensureAdminOrDirector() {
  const session = await requireSession();
  const ok =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!ok) throw new Error("Solo admin / director");
  return session;
}

/** Avisos pendientes (sin reviewed_at NI dismissed_at). */
export async function listPendingLegalNotices(): Promise<LegalNoticeRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("legal_notices")
    .select("id, boe_id, boe_date, title, url, keywords_matched, fetched_at, reviewed_at, dismissed_at")
    .is("reviewed_at", null)
    .is("dismissed_at", null)
    .order("boe_date", { ascending: false })
    .limit(50);
  if (error) {
    console.warn("[listPendingLegalNotices]", error.message);
    return [];
  }
  return (data ?? []) as LegalNoticeRow[];
}

/** Histórico (los marcados o descartados). */
export async function listResolvedLegalNotices(): Promise<LegalNoticeRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("legal_notices")
    .select("id, boe_id, boe_date, title, url, keywords_matched, fetched_at, reviewed_at, dismissed_at")
    .or("reviewed_at.not.is.null,dismissed_at.not.is.null")
    .order("fetched_at", { ascending: false })
    .limit(30);
  if (error) return [];
  return (data ?? []) as LegalNoticeRow[];
}

export async function markLegalNoticeReviewedAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("legal_notices")
      .update({
        reviewed_at: new Date().toISOString(),
        reviewed_by: session.user_id,
      })
      .eq("id", id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/fichajes/admin/leyes");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}

export async function dismissLegalNoticeAction(
  id: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("legal_notices")
      .update({
        dismissed_at: new Date().toISOString(),
        dismissed_by: session.user_id,
        dismissed_reason: reason ?? null,
      })
      .eq("id", id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/fichajes/admin/leyes");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}
