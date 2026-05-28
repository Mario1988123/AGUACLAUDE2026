import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Endpoint de autocierre de fichajes olvidados. PERO ATENCIÓN:
 *
 * NO está registrado en vercel.json porque el plan Hobby de Vercel sólo
 * permite UN cron diario por proyecto. Si en el futuro pasamos a Pro
 * podemos volver a meterlo en vercel.json con `"15 * * * *"` o similar.
 *
 * Mientras tanto el autocierre se ejecuta UNA VEZ AL DÍA dentro del cron
 * /api/cron/daily a las 22:00 UTC (00:00 hora peninsular). A esa hora
 * todas las jornadas laborales del día ya han terminado +2h, así que la
 * RPC autoclose_stale_punches cierra todo lo olvidado.
 *
 * Este endpoint sigue disponible y puede llamarse manualmente con
 * cualquier scheduler externo (Cron-job.org, EasyCron, etc.) si quieres
 * cierres más frecuentes sin pagar Vercel Pro:
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
