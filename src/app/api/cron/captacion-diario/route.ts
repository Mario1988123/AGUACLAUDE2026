import { type NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { startCronRun } from "@/shared/lib/cron/telemetry";
import { procesarColaBusquedas } from "@/modules/captacion/busqueda";
import { procesarEventosPendientes } from "@/modules/captacion/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron diario del módulo de captación (plan §5.2). Recoge los avisos de Meta
 * que se quedaron sin procesar (bandeja, fase 2) y procesa la cola de
 * búsquedas de negocios (fase 6). Sincronizar plantillas y calidad,
 * caducidades, `sin_respuesta` y retención se añaden en sus fases.
 *
 * Solo toca empresas con el módulo activo de forma explícita: el guard
 * estricto va dentro de procesarColaBusquedas.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const tracker = await startCronRun("captacion-diario");
  try {
    let pendientes = 0;
    try {
      pendientes = await procesarEventosPendientes(undefined, 200);
    } catch (e) {
      tracker.error("eventos-pendientes", e);
    }
    const r = await procesarColaBusquedas({ presupuestoMs: 240_000 });
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
      },
    });
    return NextResponse.json({ ok: true, ...r, errores: r.errores.length });
  } catch (e) {
    tracker.error("captacion-diario", e);
    await tracker.finish({ ok: false });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
