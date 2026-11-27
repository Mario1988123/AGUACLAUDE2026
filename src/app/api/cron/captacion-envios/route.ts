import { type NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { startCronRun } from "@/shared/lib/cron/telemetry";
import { procesarColaEnvios } from "@/modules/captacion/envios-servidor";
import { reintentarPropuestas } from "@/modules/captacion/mando-servidor";
import { refrescarCalidadNumeros } from "@/modules/captacion/calidad-servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron de envíos de captación (plan §4.3 y §5.2): cada 10 minutos en horario
 * de oficina. El cron de Vercel va en UTC; el horario de cada campaña se
 * comprueba en el código con la hora de Madrid.
 *
 * No sale nada si falta cualquiera de las tres llaves (módulo activo,
 * conexión con envíos encendidos y CAPTACION_ENVIOS_ACTIVOS=1).
 *
 * Fase 7: antes de enviar, pausa lo que toque (conexión, calidad,
 * cortacircuitos) y mira el tope de gasto del mes. Después, reintenta (como
 * mucho 3 veces y dentro de la ventana de 24 h) los PDF de propuesta que no
 * salieron: eso no es frío y no depende de CAPTACION_ENVIOS_ACTIVOS.
 *
 * Antes de todo, lee de Meta la calidad y el límite de los números que están
 * enviando, para que la pausa por calidad use el dato de ahora.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const tracker = await startCronRun("captacion-envios");
  try {
    const rc = await refrescarCalidadNumeros();
    for (const e of rc.errores.slice(0, 10)) tracker.error("calidad", e);
    const r = await procesarColaEnvios({ presupuestoMs: 210_000 });
    for (const e of r.errores.slice(0, 20)) tracker.error("envios", e);
    const rp = await reintentarPropuestas({ presupuestoMs: 40_000 });
    for (const e of rp.errores.slice(0, 10)) tracker.error("reintentos", e);
    await tracker.finish({
      ok: r.errores.length === 0 && rp.errores.length === 0,
      summary: {
        calidad_revisados: rc.revisados,
        empresas: r.empresas,
        enviados: r.enviados,
        fallidos: r.fallidos,
        cancelados: r.cancelados,
        colgados: r.colgados,
        recordatorios_encolados: r.recordatoriosEncolados,
        sin_respuesta: r.sinRespuesta,
        pausadas_conexion: r.pausadasConexion,
        cortacircuitos: r.cortacircuitos,
        propuestas_reintentadas: rp.revisadas,
        propuestas_enviadas: rp.enviadas,
        propuestas_fallidas: rp.fallidas,
        propuestas_agotadas: rp.agotadas,
        motivos: r.motivos.slice(0, 20),
      },
    });
    return NextResponse.json({ ok: true, ...r, errores: r.errores.length, propuestas: { ...rp, errores: rp.errores.length } });
  } catch (e) {
    tracker.error("captacion-envios", e);
    await tracker.finish({ ok: false });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
