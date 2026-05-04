import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Cron horario (Vercel Cron). Tareas que necesitan ejecutarse varias veces
 * al día — actualmente sólo el autocierre de fichajes olvidados, pero aquí
 * iría cualquier tarea de menos-de-un-día.
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
