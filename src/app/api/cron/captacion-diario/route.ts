import { type NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { startCronRun } from "@/shared/lib/cron/telemetry";
import { procesarColaBusquedas } from "@/modules/captacion/busqueda";
import { procesarEventosPendientes } from "@/modules/captacion/webhook";
import { aplicarRetencion } from "@/modules/captacion/retencion-servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Tiempo total para el trabajo (deja margen hasta los 300 s de maxDuration). */
const PRESUPUESTO_TOTAL_MS = 270_000;
const PRESUPUESTO_RETENCION_MS = 45_000;

/**
 * Cron diario del módulo de captación (plan §5.2). Recoge los avisos de Meta
 * que se quedaron sin procesar (bandeja, fase 2), aplica la retención (fase 8)
 * y procesa la cola de búsquedas de negocios (fase 6) con el tiempo que quede.
 *
 * La retención va a todas las empresas con prospectos (es una obligación,
 * no un servicio); las búsquedas, solo a las que tienen el módulo activo de
 * forma explícita (el guard estricto va dentro de procesarColaBusquedas).
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const inicio = Date.now();
  const tracker = await startCronRun("captacion-diario");
  try {
    let pendientes = 0;
    try {
      pendientes = await procesarEventosPendientes(undefined, 200);
    } catch (e) {
      tracker.error("eventos-pendientes", e);
    }

    let retencion: Awaited<ReturnType<typeof aplicarRetencion>> | null = null;
    try {
      retencion = await aplicarRetencion({ presupuestoMs: PRESUPUESTO_RETENCION_MS });
      for (const e of retencion.errores.slice(0, 20)) tracker.error("retencion", e);
    } catch (e) {
      tracker.error("retencion", e);
    }

    const restante = Math.max(30_000, PRESUPUESTO_TOTAL_MS - (Date.now() - inicio) - 20_000);
    const r = await procesarColaBusquedas({ presupuestoMs: restante });
    for (const e of r.errores.slice(0, 20)) tracker.error("busquedas", e);
    await tracker.finish({
      ok: true,
      summary: {
        busquedas: r.busquedas,
        fichas: r.fichasLeidas,
        nuevos: r.nuevos,
        revisar: r.revisar,
        descartados: r.descartados,
        duplicados: r.duplicados,
        errores: r.errores.length,
        eventos_pendientes: pendientes,
        retencion: retencion
          ? {
              prospectos: retencion.prospectos,
              conversaciones: retencion.conversaciones,
              mensajes: retencion.mensajes,
              visitas: retencion.visitas,
              propuestas: retencion.propuestas,
              envios_cancelados: retencion.enviosCancelados,
              pdfs: retencion.pdfsBorrados,
              eventos_purgados: retencion.eventosPurgados,
              cortado: retencion.cortado,
              errores: retencion.errores.length,
            }
          : null,
      },
    });
    return NextResponse.json({
      ok: true,
      ...r,
      errores: r.errores.length,
      retencion: retencion ? { ...retencion, errores: retencion.errores.length } : null,
    });
  } catch (e) {
    tracker.error("captacion-diario", e);
    await tracker.finish({ ok: false });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
