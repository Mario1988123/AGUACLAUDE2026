import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";

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
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const xCron = req.headers.get("x-cron-secret") ?? "";
  if (secret) {
    const ok = auth === `Bearer ${secret}` || xCron === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  let punchesClosed = 0;
  try {
    const { data } = await admin.rpc("autoclose_stale_punches");
    punchesClosed = Number(data) || 0;
  } catch {
    /* no-op */
  }

  return NextResponse.json({
    ok: true,
    stats: { punches_closed: punchesClosed },
    ranAt: new Date().toISOString(),
  });
}
