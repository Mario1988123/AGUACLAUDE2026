import { NextResponse } from "next/server";
import { processVerifactuQueue } from "@/modules/invoices/verifactu-queue";
import { verifyCronAuth } from "@/shared/lib/auth/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Endpoint de procesamiento de la cola Verifactu.
 *
 * PAUSADO (2026-11-09): quitado de vercel.json porque VeriFactu no se usará
 * como mínimo hasta 2028 (ver VERIFACTI_HABILITADO en invoices/verifactu-flag.ts).
 * Para reactivarlo, volver a añadir a vercel.json el schedule
 * "0,15,30,45 * * * *". El cron /api/cron/daily
 * sigue procesando la cola como red de seguridad (processVerifactuQueue es
 * idempotente: sólo toma registros pendientes).
 *
 * También invocable desde un scheduler externo o a mano.
 * Auth: Bearer ${CRON_SECRET} o `x-cron-secret: ${CRON_SECRET}`.
 */
export async function GET(req: Request) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const result = await processVerifactuQueue();
  return NextResponse.json({ ok: true, ...result });
}
