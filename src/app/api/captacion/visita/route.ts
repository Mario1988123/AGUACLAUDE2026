import { NextResponse } from "next/server";
import { admin } from "@/modules/captacion/servidor";
import { avisarResponsable } from "@/modules/captacion/avisos";
import { dispositivoDe, esAgenteAutomatico, leerPulso, referenciaDe } from "@/modules/captacion/propuesta-logica";
import { visitanteDe } from "@/modules/captacion/propuesta-servidor";

export const dynamic = "force-dynamic";

/**
 * POST /api/captacion/visita — el latido de /p/[codigo] (plan §4.5).
 * Público y sin cookies. Solo cuenta lo que manda el navegador al ejecutar
 * el script: la vista previa de WhatsApp y los antivirus piden la página
 * pero no ejecutan nada (y si lo hicieran, su agente se descarta aquí).
 * public.captacion_registrar_pulso() solo deja crecer los valores (≤ 15 s por
 * latido) y decide, una sola vez, si hay que avisar al responsable (§4.8).
 * Responde siempre 204: no da pistas de qué códigos existen.
 */
export async function POST(req: Request) {
  const vacio = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  try {
    const crudo = await req.text();
    const pulso = leerPulso(crudo);
    if (!pulso) return vacio;
    const v = visitanteDe(req.headers);
    if (esAgenteAutomatico(v.agente)) return vacio;

    const db = admin();
    const { data, error } = await db.rpc("captacion_registrar_pulso", {
      p_codigo: pulso.codigo,
      p_hash: v.hash,
      p_dia: v.dia,
      p_segundos: pulso.segundos,
      p_scroll: pulso.scroll,
      p_dispositivo: dispositivoDe(v.agente),
    });
    if (error) {
      console.error("[captacion/visita]", error.message);
      return vacio;
    }
    const fila = ((data ?? []) as Array<{ r_propuesta_id: string; r_company_id: string; r_avisar: boolean }>)[0];
    if (fila?.r_avisar) {
      const { data: p } = await db
        .from("captacion_propuestas")
        .select("id, campana_id, prospecto_id, conversacion_id, nombre_negocio, codigo, segundos_total, scroll_max, visitas")
        .eq("company_id", fila.r_company_id)
        .eq("id", fila.r_propuesta_id)
        .maybeSingle();
      const prop = p as {
        id: string;
        campana_id: string | null;
        prospecto_id: string | null;
        conversacion_id: string | null;
        nombre_negocio: string;
        codigo: string;
        segundos_total: number;
        scroll_max: number;
        visitas: number;
      } | null;
      if (prop) {
        await avisarResponsable(fila.r_company_id, prop.campana_id, {
          kind: "captacion.propuesta_leida",
          category: "event",
          title: `${prop.nombre_negocio} está leyendo la propuesta`,
          body: `Ref. ${referenciaDe(prop.codigo)}: ${prop.segundos_total} s, ${prop.scroll_max} % leído, ${prop.visitas} ${prop.visitas === 1 ? "visita" : "visitas"}.`,
          actionUrl: prop.conversacion_id ? `/captacion/bandeja/${prop.conversacion_id}` : "/captacion",
          sujetoId: prop.prospecto_id ?? prop.id,
        });
      }
    }
  } catch (e) {
    console.error("[captacion/visita]", e instanceof Error ? e.message : e);
  }
  return vacio;
}
