import { NextResponse } from "next/server";
import { processVerifactuQueue } from "@/modules/invoices/verifactu-queue";
import { verifyCronAuth } from "@/shared/lib/auth/cron";

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
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const result = await processVerifactuQueue();
  return NextResponse.json({ ok: true, ...result });
}
