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

// I18: el estado revisado/descartado es POR EMPRESA (tabla
// legal_notice_reviews). Antes se escribía en la propia fila global de
// legal_notices y un director lo cambiaba para todas las empresas.

type EstadoAviso = {
  notice_id: string;
  reviewed_at: string | null;
  dismissed_at: string | null;
};

const COLUMNAS_AVISO = "id, boe_id, boe_date, title, url, keywords_matched, fetched_at";

/** Estado de los avisos para mi empresa, indexado por notice_id. */
async function estadosDeMiEmpresa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
): Promise<Map<string, EstadoAviso>> {
  const { data, error } = await admin
    .from("legal_notice_reviews")
    .select("notice_id, reviewed_at, dismissed_at")
    .eq("company_id", companyId);
  if (error) {
    // Migración 20261002120000 aún sin aplicar: todo cuenta como pendiente.
    console.warn("[legal_notice_reviews]", error.message);
    return new Map();
  }
  return new Map(((data ?? []) as EstadoAviso[]).map((r) => [r.notice_id, r]));
}

function conEstado(
  aviso: Omit<LegalNoticeRow, "reviewed_at" | "dismissed_at">,
  estado: EstadoAviso | undefined,
): LegalNoticeRow {
  return {
    ...aviso,
    reviewed_at: estado?.reviewed_at ?? null,
    dismissed_at: estado?.dismissed_at ?? null,
  };
}

/** Avisos pendientes para mi empresa (sin revisar NI descartar). */
export async function listPendingLegalNotices(): Promise<LegalNoticeRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const estados = await estadosDeMiEmpresa(admin, session.company_id);
  const { data, error } = await admin
    .from("legal_notices")
    .select(COLUMNAS_AVISO)
    .order("boe_date", { ascending: false })
    .limit(200);
  if (error) {
    console.warn("[listPendingLegalNotices]", error.message);
    return [];
  }
  return ((data ?? []) as Array<Omit<LegalNoticeRow, "reviewed_at" | "dismissed_at">>)
    .map((a) => conEstado(a, estados.get(a.id)))
    .filter((a) => !a.reviewed_at && !a.dismissed_at)
    .slice(0, 50);
}

/** Histórico de mi empresa (los marcados o descartados). */
export async function listResolvedLegalNotices(): Promise<LegalNoticeRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const estados = await estadosDeMiEmpresa(admin, session.company_id);
  const ids = Array.from(estados.keys());
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("legal_notices")
    .select(COLUMNAS_AVISO)
    .in("id", ids)
    .order("fetched_at", { ascending: false })
    .limit(30);
  if (error) return [];
  return ((data ?? []) as Array<Omit<LegalNoticeRow, "reviewed_at" | "dismissed_at">>).map(
    (a) => conEstado(a, estados.get(a.id)),
  );
}

async function guardarEstado(
  id: string,
  campos: (userId: string) => Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await ensureAdminOrDirector();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: aviso } = await admin
    .from("legal_notices")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!aviso) return { ok: false, error: "Aviso no encontrado" };
  const r = await admin.from("legal_notice_reviews").upsert(
    { company_id: session.company_id, notice_id: id, ...campos(session.user_id) },
    { onConflict: "company_id,notice_id" },
  );
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/fichajes/admin/leyes");
  return { ok: true };
}

export async function markLegalNoticeReviewedAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await guardarEstado(id, (uid: string) => ({
      reviewed_at: new Date().toISOString(),
      reviewed_by: uid,
    }));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}

export async function dismissLegalNoticeAction(
  id: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await guardarEstado(id, (uid: string) => ({
      dismissed_at: new Date().toISOString(),
      dismissed_by: uid,
      dismissed_reason: reason ?? null,
    }));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}
