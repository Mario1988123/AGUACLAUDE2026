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
  message: string;
  steps_to_reproduce: string | null;
  technical_payload: Record<string, unknown>;
  internal_notes: string | null;
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
  days?: number;
}): Promise<ErrorReportRow[]> {
  const session = await requireSession();
  if (!session.is_superadmin) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    let q = admin
      .from("error_reports")
      .select(
        "id, company_id, reported_by, route, severity, status, message, steps_to_reproduce, technical_payload, internal_notes, created_at, resolved_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.severity) q = q.eq("severity", filters.severity);
    if (filters?.company_id) q = q.eq("company_id", filters.company_id);
    if (filters?.days) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filters.days);
      q = q.gte("created_at", cutoff.toISOString());
    }
    const { data } = await q;
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
      message: r.message,
      steps_to_reproduce: r.steps_to_reproduce,
      technical_payload: r.technical_payload,
      internal_notes: r.internal_notes,
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
