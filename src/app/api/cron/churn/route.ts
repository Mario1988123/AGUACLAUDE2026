import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { startCronRun } from "@/shared/lib/cron/telemetry";
import { agruparCambios, enTramos, type AgregadosChurn } from "./calculo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron del churn_score (auditoría 2026-10-01, C2).
 *
 * Antes vivía dentro de /api/cron/daily con ~5 consultas secuenciales por
 * cliente (1.857 clientes): el cron diario moría a los 300 s en ese bucle y
 * nunca llegaba a los recordatorios de impago ni a registrar su fin.
 *
 * Ahora:
 *  - Lee cada tabla UNA vez (paginando) y calcula en memoria.
 *  - Solo actualiza los clientes cuya puntuación cambia, agrupados por valor
 *    (unas pocas consultas en vez de una por cliente). [decide] Antes se
 *    reescribían todos los clientes cada noche y `customers.updated_at`
 *    dejaba de significar "última modificación real".
 *  - Tiene presupuesto de tiempo: si se acerca al límite, para y lo deja
 *    para la siguiente ejecución, registrando siempre su fin en cron_runs.
 *
 * Programado en vercel.json a las 03:00 UTC (fuera del cron diario).
 */

const PRESUPUESTO_MS = 240_000;
const PAGINA = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Lee todas las filas paginando; a diferencia de fetchAllRows, LANZA si falla
 *  un tramo (un dato a medias daría puntuaciones falsas). */
async function leerTodo<T>(
  construir: (desde: number, hasta: number) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
  }>,
  etiqueta: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await construir(desde, desde + PAGINA - 1);
    if (error) throw new Error(`${etiqueta}: ${error.message ?? "error"}`);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PAGINA) break;
    if (out.length > 200_000) throw new Error(`${etiqueta}: demasiadas filas`);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const tracker = await startCronRun("churn");
  const admin: Admin = createAdminClient();
  const stats = {
    customers: 0,
    changed: 0,
    updated: 0,
    update_errors: 0,
    cut_by_time: false,
  };

  try {
    const ahoraMs = Date.now();
    const seisMeses = new Date(ahoraMs - 180 * 86400000).toISOString();

    const [clientes, mantenimientos, rechazados, incidencias, cancelados] =
      await Promise.all([
        leerTodo<{ id: string; churn_score: number | null }>(
          (a, b) =>
            admin
              .from("customers")
              .select("id, churn_score")
              .is("deleted_at", null)
              .order("id")
              .range(a, b),
          "customers",
        ),
        leerTodo<{ customer_id: string | null; completed_at: string | null }>(
          (a, b) =>
            admin
              .from("maintenance_jobs")
              .select("customer_id, completed_at")
              .eq("status", "completed")
              .not("completed_at", "is", null)
              .order("id")
              .range(a, b),
          "maintenance_jobs",
        ),
        leerTodo<{ customer_id: string | null }>(
          (a, b) =>
            admin
              .from("wallet_entries")
              .select("customer_id")
              .eq("status", "rejected")
              .gte("created_at", seisMeses)
              .order("id")
              .range(a, b),
          "wallet_entries",
        ),
        leerTodo<{ customer_id: string | null }>(
          (a, b) =>
            admin
              .from("incidents")
              .select("customer_id")
              .in("status", ["open", "assigned", "in_progress"])
              .order("id")
              .range(a, b),
          "incidents",
        ),
        leerTodo<{ customer_id: string | null }>(
          (a, b) =>
            admin
              .from("contracts")
              .select("customer_id")
              .eq("status", "cancelled")
              .order("id")
              .range(a, b),
          "contracts",
        ),
      ]);

    const ag: AgregadosChurn = {
      ultimoMantenimiento: new Map(),
      conCobroRechazado: new Set(),
      conIncidenciaAbierta: new Set(),
      conContratoCancelado: new Set(),
    };
    for (const m of mantenimientos) {
      if (!m.customer_id || !m.completed_at) continue;
      const t = new Date(m.completed_at).getTime();
      const prev = ag.ultimoMantenimiento.get(m.customer_id);
      if (prev === undefined || t > prev) ag.ultimoMantenimiento.set(m.customer_id, t);
    }
    for (const r of rechazados) if (r.customer_id) ag.conCobroRechazado.add(r.customer_id);
    for (const r of incidencias) if (r.customer_id) ag.conIncidenciaAbierta.add(r.customer_id);
    for (const r of cancelados) if (r.customer_id) ag.conContratoCancelado.add(r.customer_id);

    stats.customers = clientes.length;
    const grupos = agruparCambios(clientes, ag, ahoraMs);
    const calculadoEn = new Date(ahoraMs).toISOString();

    fuera: for (const [score, ids] of grupos) {
      stats.changed += ids.length;
      // 100 uuids por tramo ≈ 3,7 KB de URL: holgado para PostgREST.
      for (const tramo of enTramos(ids, 100)) {
        if (Date.now() - tracker.startedAt > PRESUPUESTO_MS) {
          stats.cut_by_time = true;
          break fuera;
        }
        const { error } = await admin
          .from("customers")
          .update({ churn_score: score, churn_score_at: calculadoEn })
          .in("id", tramo);
        if (error) {
          stats.update_errors += tramo.length;
          tracker.error("churn-update", new Error(error.message));
        } else {
          stats.updated += tramo.length;
        }
      }
    }
  } catch (e) {
    tracker.error("churn", e);
  }

  await tracker.finish({ summary: stats });
  return NextResponse.json({ ok: tracker.errors.length === 0, stats });
}
