import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Endpoint de autocierre de fichajes olvidados.
 *
 * REGISTRADO en vercel.json con `"15 * * * *"` (cada hora, minuto 15) desde
 * que el proyecto está en plan Vercel Pro (2026-08-28). Antes no lo estaba
 * porque Hobby sólo permite 2 crons y una ejecución diaria.
 *
 * El cron /api/cron/daily sigue llamando a autoclose_stale_punches como red
 * de seguridad: es idempotente (sólo cierra fichajes abiertos y vencidos),
 * así que ejecutarlo dos veces no duplica nada.
 *
 * También puede invocarse manualmente o desde un scheduler externo:
 *   GET https://aguaclaude2026.vercel.app/api/cron/hourly
 *   Headers: x-cron-secret: <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  let punchesClosed = 0;
  let notifiedUsers = 0;
  try {
    const { data } = await admin.rpc("autoclose_stale_punches");
    punchesClosed = Number(data) || 0;

    // Notificar a usuarios afectados por autocierre. Buscamos fichajes
    // marcados auto_closed=true en la última hora (igual que la ventana
    // del cron) y emitimos una notificación con kind=time_tracking.autoclose
    // para que puedan abrir /fichajes y solicitar corrección si la hora
    // no se ajusta a la realidad.
    if (punchesClosed > 0) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: closed } = await admin
        .from("time_punches")
        .select("user_id, company_id, punched_at")
        .eq("auto_closed", true)
        .gte("punched_at", since);
      type Row = { user_id: string; company_id: string; punched_at: string };
      const rows = (closed ?? []) as Row[];
      // Dedupe por user_id (puede haber varios fichajes autocerrados a la vez)
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.user_id)) continue;
        seen.add(r.user_id);
        try {
          await admin.from("notifications").insert({
            company_id: r.company_id,
            recipient_user_id: r.user_id,
            kind: "time_tracking.autoclose",
            severity: "warning",
            title: "Fichaje cerrado automáticamente",
            body: "El sistema cerró tu fichaje por inactividad. Si la hora no es correcta, pide una corrección desde /fichajes.",
            subject_type: "time_punch",
            subject_id: null,
          });
          notifiedUsers++;
        } catch {
          /* fail-soft */
        }
      }
    }
  } catch {
    /* no-op */
  }

  return NextResponse.json({
    ok: true,
    stats: { punches_closed: punchesClosed, notified_users: notifiedUsers },
    ranAt: new Date().toISOString(),
  });
}
