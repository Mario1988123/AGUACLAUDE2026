import { type NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { startCronRun } from "@/shared/lib/cron/telemetry";
import { procesarColaBusquedas } from "@/modules/captacion/busqueda";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron diario del módulo de captación (plan §5.2). De momento solo procesa
 * la cola de búsquedas de negocios (fase 6). Sincronizar plantillas y calidad,
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
    const r = await procesarColaBusquedas({ presupuestoMs: 270_000 });
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
      },
    });
    return NextResponse.json({ ok: true, ...r, errores: r.errores.length });
  } catch (e) {
    tracker.error("captacion-diario", e);
    await tracker.finish({ ok: false });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
