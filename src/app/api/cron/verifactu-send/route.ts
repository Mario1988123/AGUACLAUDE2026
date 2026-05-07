import { NextResponse } from "next/server";
import { processVerifactuQueue } from "@/modules/invoices/verifactu-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Endpoint de procesamiento Verifactu — invocable desde:
 *  · Vercel Cron (plan Pro): schedule en vercel.json cada 15 min.
 *  · Servicio externo gratuito (cron-job.org) cada 15 min con
 *    header `Authorization: Bearer <CRON_SECRET>`.
 *  · Manualmente desde el panel admin (próxima iteración).
 *
 * En Vercel Hobby la cola Verifactu también se procesa dentro del
 * cron `/api/cron/daily` automáticamente para no necesitar plan Pro.
 *
 * Auth: Bearer ${CRON_SECRET} o `x-cron-secret: ${CRON_SECRET}`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const xCron = req.headers.get("x-cron-secret") ?? "";
  if (secret) {
    const ok = auth === `Bearer ${secret}` || xCron === secret;
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await processVerifactuQueue();
  return NextResponse.json({ ok: true, ...result });
}
