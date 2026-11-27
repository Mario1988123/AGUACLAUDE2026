/**
 * Lógica pura de la retención (fase 8, plan §3 y §8). Sin base de datos ni
 * red, para probarla con vitest. La base repite estas reglas en
 * captacion_retencion_candidatos y captacion_anonimizar_prospectos
 * (migración 20261129200000): aquí se deciden y allí se vuelven a comprobar.
 *
 * Reglas:
 *  · Se anonimiza el prospecto que nunca llegó a lead (sin lead_id y fuera de
 *    las etapas de interés) y lleva `retencion_dias` sin movimiento.
 *  · Nunca: los que tienen lead, los interesados, calientes o convertidos, ni
 *    captacion_bloqueos (no pasan por aquí).
 *  · captacion_webhook_eventos: 30 días.
 */

export const RETENCION_DIAS_POR_DEFECTO = 365;
export const RETENCION_DIAS_MIN = 30;
export const RETENCION_DIAS_MAX = 3650;
export const RETENCION_WEBHOOK_DIAS = 30;

/** Ha mostrado interés o ya es lead: no se anonimiza nunca. */
export const ETAPAS_PROTEGIDAS = ["interesado", "caliente", "convertido"] as const;

const DIA_MS = 86_400_000;

/** retencion_dias de la empresa, acotado como el CHECK de la columna (365 si falta). */
export function diasRetencion(valor: number | null | undefined): number {
  if (valor == null || !Number.isFinite(valor)) return RETENCION_DIAS_POR_DEFECTO;
  return Math.min(RETENCION_DIAS_MAX, Math.max(RETENCION_DIAS_MIN, Math.floor(valor)));
}

/** Lo anterior a esta fecha está fuera de plazo. */
export function limiteRetencion(ahora: Date, dias: number): Date {
  return new Date(ahora.getTime() - diasRetencion(dias) * DIA_MS);
}

/** Fecha antes de la cual se purgan los eventos de webhook. */
export function limiteWebhook(ahora: Date): Date {
  return new Date(ahora.getTime() - RETENCION_WEBHOOK_DIAS * DIA_MS);
}

export interface CandidatoRetencion {
  id: string;
  company_id: string;
  etapa: string;
  lead_id: string | null;
  anonimizado_at: string | null;
  ultimo_movimiento: string | null;
  retencion_dias: number | null;
}

export type DecisionRetencion = { anonimizar: true } | { anonimizar: false; motivo: string };

export function decidirAnonimizar(c: CandidatoRetencion, ahora: Date): DecisionRetencion {
  if (c.anonimizado_at) return { anonimizar: false, motivo: "Ya está anonimizado." };
  if (c.lead_id) return { anonimizar: false, motivo: "Es lead: no se toca." };
  if ((ETAPAS_PROTEGIDAS as readonly string[]).includes(c.etapa)) {
    return { anonimizar: false, motivo: "Mostró interés: no se toca." };
  }
  // Sin fecha de movimiento no se sabe cuánto lleva: mejor no tocarlo.
  const t = c.ultimo_movimiento ? new Date(c.ultimo_movimiento).getTime() : Number.NaN;
  if (!Number.isFinite(t)) return { anonimizar: false, motivo: "Sin fecha de último movimiento." };
  if (t >= limiteRetencion(ahora, c.retencion_dias ?? RETENCION_DIAS_POR_DEFECTO).getTime()) {
    return { anonimizar: false, motivo: "Aún dentro del plazo." };
  }
  return { anonimizar: true };
}

/** Lotes por empresa con los ids que hay que anonimizar, de tamaño ≤ `tamano`. */
export function lotesPorEmpresa(
  candidatos: CandidatoRetencion[],
  ahora: Date,
  tamano = 100,
): Array<{ companyId: string; ids: string[] }> {
  const porEmpresa = new Map<string, string[]>();
  for (const c of candidatos) {
    if (!decidirAnonimizar(c, ahora).anonimizar) continue;
    porEmpresa.set(c.company_id, [...(porEmpresa.get(c.company_id) ?? []), c.id]);
  }
  const t = Math.max(1, Math.floor(tamano));
  const out: Array<{ companyId: string; ids: string[] }> = [];
  for (const [companyId, ids] of porEmpresa) {
    for (let i = 0; i < ids.length; i += t) out.push({ companyId, ids: ids.slice(i, i + t) });
  }
  return out;
}

export interface ResumenRetencion {
  prospectos: number;
  conversaciones: number;
  mensajes: number;
  visitas: number;
  propuestas: number;
  enviosCancelados: number;
  pdfsBorrados: number;
  eventosPurgados: number;
  /** Se cortó por el presupuesto de tiempo: queda trabajo para mañana. */
  cortado: boolean;
  errores: string[];
}

export const RESUMEN_RETENCION_VACIO: ResumenRetencion = {
  prospectos: 0,
  conversaciones: 0,
  mensajes: 0,
  visitas: 0,
  propuestas: 0,
  enviosCancelados: 0,
  pdfsBorrados: 0,
  eventosPurgados: 0,
  cortado: false,
  errores: [],
};

/** Suma lo que devuelve captacion_anonimizar_prospectos (números o textos). */
export function sumarAnonimizado(r: ResumenRetencion, fila: unknown): ResumenRetencion {
  const f = (fila && typeof fila === "object" ? fila : {}) as Record<string, unknown>;
  const n = (k: string) => {
    const v = Number(f[k] ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    ...r,
    prospectos: r.prospectos + n("prospectos"),
    conversaciones: r.conversaciones + n("conversaciones"),
    mensajes: r.mensajes + n("mensajes"),
    visitas: r.visitas + n("visitas"),
    propuestas: r.propuestas + n("propuestas"),
    enviosCancelados: r.enviosCancelados + n("envios_cancelados"),
  };
}
