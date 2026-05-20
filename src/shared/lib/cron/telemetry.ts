import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * Wrapper para registrar una ejecución de cron job en `cron_runs`.
 * Uso:
 *   const tracker = await startCronRun("daily");
 *   try { ... } catch (e) { tracker.error("section", e); }
 *   await tracker.finish({ summary: {...} });
 *
 * No bloquea el flujo principal — si la tabla cron_runs no existe
 * (migración pendiente) silencia el error.
 */
export interface CronTracker {
  id: string | null;
  startedAt: number;
  errors: Array<{ section: string; message: string }>;
  error(section: string, e: unknown): void;
  finish(opts?: { ok?: boolean; summary?: Record<string, unknown> }): Promise<void>;
}

export async function startCronRun(job: string): Promise<CronTracker> {
  const startedAt = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let id: string | null = null;
  try {
    const { data } = await admin
      .from("cron_runs")
      .insert({ job, started_at: new Date(startedAt).toISOString() })
      .select("id")
      .single();
    id = (data as { id: string } | null)?.id ?? null;
  } catch {
    /* tabla no migrada; seguimos sin telemetría */
  }
  const errors: Array<{ section: string; message: string }> = [];
  return {
    id,
    startedAt,
    errors,
    error(section: string, e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ section, message: msg });
      console.error(`[cron:${job}] ${section}:`, msg);
    },
    async finish(opts?: { ok?: boolean; summary?: Record<string, unknown> }) {
      if (!id) return;
      const duration_ms = Date.now() - startedAt;
      const ok = opts?.ok ?? errors.length === 0;
      try {
        await admin
          .from("cron_runs")
          .update({
            ended_at: new Date().toISOString(),
            ok,
            duration_ms,
            errors_count: errors.length,
            summary: {
              ...(opts?.summary ?? {}),
              ...(errors.length > 0 ? { errors } : {}),
            },
          })
          .eq("id", id);
      } catch {
        /* */
      }
    },
  };
}

/**
 * Devuelve el estado de salud de los crons (últimas 24h).
 * Usado por la card admin "/superadmin" para mostrar si algo falló.
 */
export async function getCronHealth(): Promise<{
  ok: boolean;
  recent: Array<{
    job: string;
    started_at: string;
    ok: boolean | null;
    duration_ms: number | null;
    errors_count: number;
  }>;
  failures_last_24h: number;
}> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data } = await admin
      .from("cron_runs")
      .select("job, started_at, ok, duration_ms, errors_count")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as Array<{
      job: string;
      started_at: string;
      ok: boolean | null;
      duration_ms: number | null;
      errors_count: number;
    }>;
    const failures = rows.filter((r) => r.ok === false).length;
    return { ok: failures === 0, recent: rows, failures_last_24h: failures };
  } catch {
    return { ok: true, recent: [], failures_last_24h: 0 };
  }
}
