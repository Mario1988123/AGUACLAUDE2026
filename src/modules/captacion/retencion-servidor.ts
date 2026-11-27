import "server-only";
import { admin } from "./servidor";
import { BUCKET_PROPUESTAS } from "./propuesta-servidor";
import {
  limiteWebhook,
  lotesPorEmpresa,
  RESUMEN_RETENCION_VACIO,
  sumarAnonimizado,
  type CandidatoRetencion,
  type ResumenRetencion,
} from "./retencion-logica";

/**
 * Retención automática (fase 8). La llama el cron `captacion-diario`.
 *
 *  1. Purga de captacion_webhook_eventos de más de 30 días, por tandas.
 *  2. Prospectos que nunca llegaron a lead y llevan `retencion_dias` sin
 *     movimiento: captacion_anonimizar_prospectos (una transacción por lote,
 *     que vuelve a comprobarlo todo).
 *  3. PDF de las propuestas anonimizadas: se borran del bucket y después se
 *     vacía pdf_ruta. Si el borrado falla, la propuesta ya está revocada y se
 *     reintenta en la pasada siguiente.
 *
 * Va a todas las empresas que tengan prospectos, tengan o no el módulo
 * activo: apagar el módulo no exime de borrar los datos [decide].
 * captacion_bloqueos no se toca nunca (ni la base lo hace).
 */

const TANDA_EVENTOS = 1000;
const MAX_TANDAS_EVENTOS = 50;
const TANDA_CANDIDATOS = 500;
const TAMANO_LOTE = 100;
const MAX_RONDAS = 20;
const TANDA_PDF = 100;

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
}

export async function aplicarRetencion(opts: { presupuestoMs: number; ahora?: Date }): Promise<ResumenRetencion> {
  const inicio = Date.now();
  const ahora = opts.ahora ?? new Date();
  const queda = () => opts.presupuestoMs - (Date.now() - inicio);
  const db = admin();
  let r: ResumenRetencion = { ...RESUMEN_RETENCION_VACIO, errores: [] };

  // 1) Eventos de webhook.
  for (let i = 0; i < MAX_TANDAS_EVENTOS; i++) {
    if (queda() <= 0) {
      r.cortado = true;
      break;
    }
    const { data, error } = await db.rpc("captacion_purgar_webhook_eventos", {
      p_antes: limiteWebhook(ahora).toISOString(),
      p_limite: TANDA_EVENTOS,
    });
    if (error) {
      r.errores.push(`eventos: ${error.message}`);
      break;
    }
    const n = Number(data ?? 0);
    r.eventosPurgados += n;
    if (n < TANDA_EVENTOS) break;
  }

  // 2) PDF pendientes de pasadas anteriores.
  r = await borrarPdfsAnonimizados(r, queda);

  // 3) Prospectos.
  for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
    if (queda() <= 0) {
      r.cortado = true;
      break;
    }
    const { data, error } = await db.rpc("captacion_retencion_candidatos", {
      p_ahora: ahora.toISOString(),
      p_limite: TANDA_CANDIDATOS,
      p_company_id: null,
    });
    if (error) {
      r.errores.push(`candidatos: ${error.message}`);
      break;
    }
    const candidatos = (data ?? []) as CandidatoRetencion[];
    const lotes = lotesPorEmpresa(candidatos, ahora, TAMANO_LOTE);
    const antes = r.prospectos;
    for (const lote of lotes) {
      if (queda() <= 0) {
        r.cortado = true;
        break;
      }
      const { data: fila, error: e2 } = await db.rpc("captacion_anonimizar_prospectos", {
        p_company_id: lote.companyId,
        p_ids: lote.ids,
        p_ahora: ahora.toISOString(),
      });
      if (e2) {
        r.errores.push(`${lote.companyId}: ${e2.message}`);
        continue;
      }
      r = sumarAnonimizado(r, Array.isArray(fila) ? fila[0] : fila);
    }
    // Menos de una tanda: no hay más. Una ronda sin avances: no se insiste.
    if (r.cortado || candidatos.length < TANDA_CANDIDATOS || r.prospectos === antes) break;
  }

  // 4) Los PDF de lo que se acaba de anonimizar.
  r = await borrarPdfsAnonimizados(r, queda);
  return r;
}

/** Borra del bucket los PDF de propuestas revocadas cuyo prospecto está anonimizado. */
async function borrarPdfsAnonimizados(r: ResumenRetencion, queda: () => number): Promise<ResumenRetencion> {
  const db = admin();
  let out = r;
  for (let i = 0; i < 50; i++) {
    if (queda() <= 0) return { ...out, cortado: true };
    const { data, error } = await db
      .from("captacion_propuestas")
      .select("id, company_id, pdf_ruta, captacion_prospectos!inner(anonimizado_at)")
      .not("pdf_ruta", "is", null)
      .not("revocada_at", "is", null)
      .not("captacion_prospectos.anonimizado_at", "is", null)
      .limit(TANDA_PDF);
    if (error) return { ...out, errores: [...out.errores, `pdf: ${error.message}`] };
    const filas = (data ?? []) as Array<{ id: string; company_id: string; pdf_ruta: string }>;
    if (filas.length === 0) return out;

    const porEmpresa = new Map<string, Array<{ id: string; ruta: string }>>();
    for (const f of filas) porEmpresa.set(f.company_id, [...(porEmpresa.get(f.company_id) ?? []), { id: f.id, ruta: f.pdf_ruta }]);
    let hechos = 0;
    for (const [companyId, lista] of porEmpresa) {
      // Solo rutas de la propia empresa (company_id/…): una ruta rara no se borra.
      const validas = lista.filter((x) => x.ruta.startsWith(`${companyId}/`));
      try {
        if (validas.length > 0) {
          const { error: eS } = await db.storage.from(BUCKET_PROPUESTAS).remove(validas.map((x) => x.ruta));
          if (eS) throw eS;
        }
        // Las de ruta rara también se vacían: no se sirven (están revocadas) y
        // así no se vuelven a mirar cada noche; quedan en el registro de errores.
        const { error: eU } = await db
          .from("captacion_propuestas")
          .update({ pdf_ruta: null, pdf_bytes: null, pdf_paginas: null })
          .eq("company_id", companyId)
          .in("id", lista.map((x) => x.id));
        if (eU) throw eU;
        hechos += lista.length;
        out = { ...out, pdfsBorrados: out.pdfsBorrados + validas.length };
        if (validas.length < lista.length) {
          out = { ...out, errores: [...out.errores, `${companyId}: ${lista.length - validas.length} PDF con ruta fuera de la empresa; revisar a mano.`] };
        }
      } catch (e) {
        out = { ...out, errores: [...out.errores, `pdf ${companyId}: ${mensaje(e)}`] };
      }
    }
    // Si nada salió bien en esta tanda, se para (si no, se repetiría igual).
    if (hechos === 0 || filas.length < TANDA_PDF) return out;
  }
  return out;
}
