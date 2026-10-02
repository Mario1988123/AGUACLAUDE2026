import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { startCronRun } from "@/shared/lib/cron/telemetry";

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

  const tracker = await startCronRun("hourly");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  let punchesClosed = 0;
  let notifiedUsers = 0;
  try {
    const { data, error } = await admin.rpc("autoclose_stale_punches");
    if (error) throw new Error(error.message);
    punchesClosed = Number(data) || 0;
  } catch (e) {
    tracker.error("autoclose", e);
  }

  // Notificar a los trabajadores con fichajes autocerrados (auditoría
  // 2026-10-01, C8). Antes se buscaba `punched_at >= ahora − 1 h`, pero la
  // función solo cierra cuando ya han pasado 2 h desde el fin de jornada y
  // pone `punched_at` = fin de jornada: nunca encontraba nada. Ahora se miran
  // los autocierres de los últimos 3 días que aún no tienen su aviso
  // (dedupe por subject_id = id del fichaje), así que también se recuperan
  // los que una ejecución anterior no llegó a notificar.
  try {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: closed, error } = await admin
      .from("time_punches")
      .select("id, user_id, company_id, punched_at")
      .eq("auto_closed", true)
      .gte("punched_at", since)
      .limit(500);
    if (error) throw new Error(error.message);
    type Row = { id: string; user_id: string; company_id: string; punched_at: string };
    const rows = (closed ?? []) as Row[];
    if (rows.length > 0) {
      const { data: ya } = await admin
        .from("notifications")
        .select("subject_id")
        .eq("kind", "time_tracking.autoclose")
        .in(
          "subject_id",
          rows.map((r) => r.id),
        );
      const avisados = new Set(
        ((ya ?? []) as Array<{ subject_id: string | null }>).map((n) => n.subject_id),
      );
      for (const r of rows) {
        if (avisados.has(r.id)) continue;
        const hora = new Date(r.punched_at).toLocaleString("es-ES", {
          timeZone: "Europe/Madrid",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        const { error: errIns } = await admin.from("notifications").insert({
          company_id: r.company_id,
          recipient_user_id: r.user_id,
          kind: "time_tracking.autoclose",
          category: "alert",
          severity: "warning",
          title: "Fichaje cerrado automáticamente",
          body: `El sistema cerró tu fichaje a las ${hora}. Si la hora no es correcta, pide una corrección desde /fichajes.`,
          subject_type: "time_punch",
          subject_id: r.id,
          action_url: "/fichajes",
        });
        if (errIns) tracker.error("autoclose-notify", new Error(errIns.message));
        else notifiedUsers++;
      }
    }
  } catch (e) {
    tracker.error("autoclose-notify-outer", e);
  }

  // VeriFactu vía Verifacti: consultar los registros que siguen "Pendiente"
  // (Verifacti los procesa en ~1 min). Sin empresas activas no hace nada.
  let verifactiConsultados = 0;
  try {
    const { actualizarEstadosPendientesVerifacti } = await import(
      "@/modules/invoices/external-providers/verifacti-envio"
    );
    const r = await actualizarEstadosPendientesVerifacti(admin);
    verifactiConsultados = r.consultados;
  } catch (e) {
    tracker.error("verifacti-estados", e);
  }

  const stats = {
    punches_closed: punchesClosed,
    notified_users: notifiedUsers,
    verifacti_consultados: verifactiConsultados,
  };
  await tracker.finish({ summary: stats });
  return NextResponse.json({
    ok: true,
    stats,
    ranAt: new Date().toISOString(),
  });
}
