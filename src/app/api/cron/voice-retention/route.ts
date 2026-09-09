import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { startCronRun } from "@/shared/lib/cron/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Retención de las conversaciones del agente de voz.
 *
 * Cada empresa fija su plazo (`transcript_retention_days`, 90 días por
 * defecto). Pasado ese plazo se borra **el contenido** de la llamada:
 * transcripción, resumen y grabación. La FILA se conserva.
 *
 * Esa distinción es lo importante y conviene dejarla escrita:
 *
 *  · Lo que se borra es lo que deja de ser necesario para la finalidad —
 *    la conversación en sí. Guardarla indefinidamente no tiene base legal.
 *
 *  · Lo que se conserva es la prueba de cumplimiento: que se declaró ser una
 *    IA (art. 50 del Reglamento de IA), que se ofreció hablar con una persona
 *    (Ley 10/2025), a qué hora se llamó y cuánto duró. Eso puede hacer falta
 *    mucho después, justamente para defenderse de una reclamación sobre una
 *    llamada cuyo contenido ya no existe.
 *
 * Se ejecuta de madrugada, por lotes, y es idempotente: `transcript_purged_at`
 * marca lo ya purgado, así que dos ejecuciones seguidas no hacen daño ni
 * trabajo de más.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const tracker = await startCronRun("voice-retention");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const stats = { purged: 0, batches: 0, orphan_tasks_closed: 0, errors: 0 };

  // --- 1. Purga de contenido conversacional ---
  // En lotes acotados: una empresa con un año de llamadas acumuladas podría
  // tener miles de filas vencidas el primer día que se active esto, y un
  // UPDATE masivo dentro del maxDuration de Vercel se corta a la mitad.
  try {
    for (let i = 0; i < 20; i++) {
      const { data, error } = await admin.rpc("voice_purge_transcripts", {
        p_limit: 500,
      });
      if (error) throw error;
      const n = Number(data ?? 0);
      stats.purged += n;
      stats.batches++;
      if (n < 500) break; // ya no quedaba un lote completo: hemos terminado
    }
  } catch (e) {
    tracker.error("purge", e);
    stats.errors++;
  }

  // --- 2. Tareas zombi ---
  // Una tarea que lleva días en 'calling' es una llamada cuyo webhook de
  // cierre nunca llegó. El marcador ya libera las de los últimos 15 minutos;
  // esto recoge las que se quedaron atrás por una caída larga del proveedor.
  try {
    const { data } = await admin
      .from("voice_call_tasks")
      .update({
        status: "failed",
        outcome: "failed",
        outcome_notes:
          "La plataforma de voz nunca confirmó el cierre de la llamada. Revisar a mano.",
        locked_at: null,
        lock_token: null,
      })
      .eq("status", "calling")
      .lt("locked_at", new Date(Date.now() - 6 * 3600_000).toISOString())
      .select("id");
    stats.orphan_tasks_closed = (data as unknown[] | null)?.length ?? 0;
  } catch (e) {
    tracker.error("orphans", e);
    stats.errors++;
  }

  await tracker.finish({ summary: stats });
  return NextResponse.json({ ok: true, stats });
}
