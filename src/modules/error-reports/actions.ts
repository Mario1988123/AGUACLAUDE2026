"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const reportSchema = z.object({
  route: z.string().max(500).nullish(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  message: z.string().trim().min(5).max(2000),
  steps_to_reproduce: z.string().trim().max(2000).nullish(),
  technical_payload: z.record(z.unknown()).nullish(),
});

export interface ErrorReportRow {
  id: string;
  company_id: string | null;
  company_name: string | null;
  reported_by_name: string | null;
  route: string | null;
  severity: "low" | "medium" | "high" | "critical";
  status: "new" | "triaged" | "in_progress" | "resolved" | "closed" | "wont_fix";
  /** 'manual' = lo escribió el usuario · 'auto_toast' = capturado al saltar un toast de error. */
  source: "manual" | "auto_toast";
  message: string;
  steps_to_reproduce: string | null;
  technical_payload: Record<string, unknown>;
  internal_notes: string | null;
  /** Veces que se ha visto este mismo error (agrupado por huella). */
  occurrences: number;
  /** Última vez que se vio (errores automáticos agrupados). */
  last_seen_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

/**
 * Cualquier usuario autenticado de cualquier empresa puede reportar un
 * fallo. El reporte queda en error_reports para que el superadmin lo vea.
 *
 * No requiere rol especial — RLS permite INSERT a authenticated y la
 * policy fuerza company_id = current_company_id().
 */
export async function reportErrorAction(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const parsed = parseOrFriendly(reportSchema, input, "Reportar fallo");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("error_reports")
      .insert({
        company_id: session.company_id ?? null,
        reported_by: session.user_id,
        route: parsed.route ?? null,
        severity: parsed.severity,
        message: parsed.message,
        steps_to_reproduce: parsed.steps_to_reproduce ?? null,
        technical_payload: parsed.technical_payload ?? {},
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Lista reportes para el panel superadmin. Filtros opcionales.
 * Devuelve nombres resueltos para company y reporter.
 */
export async function listErrorReports(filters?: {
  status?: string;
  severity?: string;
  company_id?: string;
  source?: string;
  days?: number;
}): Promise<ErrorReportRow[]> {
  const session = await requireSession();
  if (!session.is_superadmin) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    // Columnas nuevas (migración 20260702200000). Lectura defensiva: si la
    // migración aún no está aplicada, reintentamos sin ellas.
    const COLS_NEW =
      "id, company_id, reported_by, route, severity, status, source, message, steps_to_reproduce, technical_payload, internal_notes, occurrences, last_seen_at, created_at, resolved_at";
    const COLS_LEGACY =
      "id, company_id, reported_by, route, severity, status, message, steps_to_reproduce, technical_payload, internal_notes, created_at, resolved_at";
    const buildQuery = (cols: string, withSource: boolean) => {
      let q = admin
        .from("error_reports")
        .select(cols)
        .order("created_at", { ascending: false })
        .limit(500);
      if (filters?.status) q = q.eq("status", filters.status);
      if (filters?.severity) q = q.eq("severity", filters.severity);
      if (filters?.company_id) q = q.eq("company_id", filters.company_id);
      if (withSource && filters?.source) q = q.eq("source", filters.source);
      if (filters?.days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - filters.days);
        q = q.gte("created_at", cutoff.toISOString());
      }
      return q;
    };
    let res = await buildQuery(COLS_NEW, true);
    if (res.error) {
      res = await buildQuery(COLS_LEGACY, false);
    }
    const data = res.data;
    type Row = Omit<ErrorReportRow, "company_name" | "reported_by_name"> & {
      reported_by: string | null;
    };
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return [];
    const companyIds = Array.from(
      new Set(rows.map((r) => r.company_id).filter((v): v is string => !!v)),
    );
    const userIds = Array.from(
      new Set(rows.map((r) => r.reported_by).filter((v): v is string => !!v)),
    );
    const [compsRes, profsRes] = await Promise.all([
      companyIds.length > 0
        ? admin.from("companies").select("id, name").in("id", companyIds)
        : Promise.resolve({ data: [] }),
      userIds.length > 0
        ? admin.from("user_profiles").select("user_id, full_name").in("user_id", userIds)
        : Promise.resolve({ data: [] }),
    ]);
    const compMap = new Map(
      ((compsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [
        c.id,
        c.name,
      ]),
    );
    const profMap = new Map(
      ((profsRes.data ?? []) as Array<{ user_id: string; full_name: string }>).map(
        (p) => [p.user_id, p.full_name],
      ),
    );
    return rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      company_name: r.company_id ? compMap.get(r.company_id) ?? null : null,
      reported_by_name: r.reported_by ? profMap.get(r.reported_by) ?? null : null,
      route: r.route,
      severity: r.severity,
      status: r.status,
      source: (r.source ?? "manual") as "manual" | "auto_toast",
      message: r.message,
      steps_to_reproduce: r.steps_to_reproduce,
      technical_payload: r.technical_payload,
      internal_notes: r.internal_notes,
      occurrences: r.occurrences ?? 1,
      last_seen_at: r.last_seen_at ?? null,
      created_at: r.created_at,
      resolved_at: r.resolved_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Cuenta reportes nuevos / abiertos para badge en dashboard superadmin.
 */
export async function countOpenErrorReports(): Promise<{
  new: number;
  in_progress: number;
  by_severity: { critical: number; high: number };
}> {
  const session = await requireSession();
  const out = {
    new: 0,
    in_progress: 0,
    by_severity: { critical: 0, high: 0 },
  };
  if (!session.is_superadmin) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { count: nNew } = await admin
      .from("error_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "new");
    out.new = nNew ?? 0;
    const { count: nIn } = await admin
      .from("error_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "in_progress");
    out.in_progress = nIn ?? 0;
    const { count: nCrit } = await admin
      .from("error_reports")
      .select("id", { count: "exact", head: true })
      .eq("severity", "critical")
      .in("status", ["new", "triaged", "in_progress"]);
    out.by_severity.critical = nCrit ?? 0;
    const { count: nHigh } = await admin
      .from("error_reports")
      .select("id", { count: "exact", head: true })
      .eq("severity", "high")
      .in("status", ["new", "triaged", "in_progress"]);
    out.by_severity.high = nHigh ?? 0;
  } catch {
    /* */
  }
  return out;
}

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "triaged", "in_progress", "resolved", "closed", "wont_fix"]).nullish(),
  internal_notes: z.string().trim().max(2000).nullish(),
});

/**
 * Triaje del superadmin: cambia status y/o añade notas internas.
 */
export async function updateErrorReportAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.is_superadmin) return { ok: false, error: "Solo superadmin" };
    const parsed = parseOrFriendly(updateSchema, input, "Actualizar reporte");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const update: Record<string, unknown> = {};
    if (parsed.status) update.status = parsed.status;
    if (parsed.internal_notes !== undefined) update.internal_notes = parsed.internal_notes;
    if (parsed.status === "resolved" || parsed.status === "closed") {
      update.resolved_at = new Date().toISOString();
      update.resolved_by = session.user_id;
    }
    const r = await admin.from("error_reports").update(update).eq("id", parsed.id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/superadmin");
    revalidatePath("/superadmin/errores");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

// ============================================================================
// Captura AUTOMÁTICA de errores (toasts) — 2026-07-02
// ============================================================================

const autoLogSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  route: z.string().max(500).nullish(),
  technical_payload: z.record(z.unknown()).nullish(),
});

/**
 * "Huella" de un error para agrupar repetidos: mensaje + ruta, normalizados
 * (se quitan uuids y números variables) para que dos errores "iguales pero con
 * ids distintos" cuenten como el mismo. Sin esto el panel se llenaría de
 * duplicados.
 */
function buildFingerprint(message: string, route: string | null): string {
  const UUID =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const normMsg = message
    .toLowerCase()
    .replace(UUID, "#id")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const normRoute = (route ?? "").replace(UUID, "#id").replace(/\d+/g, "#");
  return `${normRoute}::${normMsg}`.slice(0, 400);
}

/**
 * Registra AUTOMÁTICAMENTE un toast de error. La llama `notify.error` en el
 * cliente (fire-and-forget). Agrupa repetidos: si ya existe una fila abierta
 * con la misma huella, incrementa el contador en vez de crear otra.
 *
 * NUNCA lanza ni molesta al usuario: ante cualquier problema devuelve
 * { ok:false } en silencio. Registrar un error jamás debe romper la UI.
 */
export async function logClientErrorAction(
  input: unknown,
): Promise<{ ok: boolean }> {
  try {
    const session = await requireSession();
    const parsed = autoLogSchema.safeParse(input);
    if (!parsed.success) return { ok: false };
    const message = parsed.data.message.trim().slice(0, 2000);
    if (message.length < 3) return { ok: false };
    const route = parsed.data.route?.trim().slice(0, 500) || null;
    const fingerprint = buildFingerprint(message, route);
    const companyId = session.company_id ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // ¿Existe ya una fila ABIERTA con esta huella? → incrementar contador.
    let existingQ = admin
      .from("error_reports")
      .select("id, occurrences")
      .eq("source", "auto_toast")
      .eq("fingerprint", fingerprint)
      .in("status", ["new", "triaged", "in_progress"])
      .limit(1);
    existingQ = companyId
      ? existingQ.eq("company_id", companyId)
      : existingQ.is("company_id", null);
    const { data: existing } = await existingQ.maybeSingle();
    const ex = existing as { id: string; occurrences: number } | null;
    const nowIso = new Date().toISOString();
    if (ex) {
      await admin
        .from("error_reports")
        .update({
          occurrences: (ex.occurrences ?? 1) + 1,
          last_seen_at: nowIso,
        })
        .eq("id", ex.id);
      return { ok: true };
    }
    await admin.from("error_reports").insert({
      company_id: companyId,
      reported_by: session.user_id,
      route,
      severity: "low",
      source: "auto_toast",
      message,
      fingerprint,
      occurrences: 1,
      last_seen_at: nowIso,
      technical_payload: parsed.data.technical_payload ?? {},
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export interface TopAutoError {
  fingerprint: string;
  message: string;
  route: string | null;
  total_occurrences: number;
  companies_affected: number;
  last_seen_at: string | null;
}

/**
 * Ranking "errores más frecuentes" para el panel del superadmin. Agrupa los
 * errores automáticos por huella (sumando ocurrencias y empresas afectadas,
 * también entre empresas) y los ordena de más a menos veces.
 */
export async function getTopAutoErrors(days = 30): Promise<TopAutoError[]> {
  const session = await requireSession();
  if (!session.is_superadmin) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const { data, error } = await admin
      .from("error_reports")
      .select(
        "fingerprint, message, route, occurrences, company_id, last_seen_at, created_at",
      )
      .eq("source", "auto_toast")
      .gte("created_at", cutoff.toISOString())
      .limit(2000);
    if (error) return [];
    type Row = {
      fingerprint: string | null;
      message: string;
      route: string | null;
      occurrences: number | null;
      company_id: string | null;
      last_seen_at: string | null;
      created_at: string;
    };
    const rows = (data ?? []) as Row[];
    const map = new Map<
      string,
      TopAutoError & { _companies: Set<string> }
    >();
    for (const r of rows) {
      const key = r.fingerprint ?? r.message;
      const occ = r.occurrences ?? 1;
      const last = r.last_seen_at ?? r.created_at;
      const cur = map.get(key);
      if (cur) {
        cur.total_occurrences += occ;
        if (r.company_id) cur._companies.add(r.company_id);
        if (last && (!cur.last_seen_at || last > cur.last_seen_at)) {
          cur.last_seen_at = last;
        }
      } else {
        const s = new Set<string>();
        if (r.company_id) s.add(r.company_id);
        map.set(key, {
          fingerprint: key,
          message: r.message,
          route: r.route,
          total_occurrences: occ,
          companies_affected: 0,
          last_seen_at: last,
          _companies: s,
        });
      }
    }
    return [...map.values()]
      .map((v) => ({
        fingerprint: v.fingerprint,
        message: v.message,
        route: v.route,
        total_occurrences: v.total_occurrences,
        companies_affected: v._companies.size,
        last_seen_at: v.last_seen_at,
      }))
      .sort((a, b) => b.total_occurrences - a.total_occurrences)
      .slice(0, 25);
  } catch {
    return [];
  }
}
