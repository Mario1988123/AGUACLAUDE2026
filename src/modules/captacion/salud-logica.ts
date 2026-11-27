/**
 * Lógica pura del panel de salud para Vercomi (fase 8, /superadmin/captacion).
 * Sin base de datos ni red, para probarla con vitest. Los números llegan de
 * public.captacion_salud_empresas (migración 20261129200000): conteos
 * exactos hechos en SQL, sin el tope de 1.000 filas de PostgREST.
 */

import { evaluarGasto, type EstadoGasto } from "./mando-logica";

export interface FilaSalud {
  companyId: string;
  empresa: string;
  /** Null: la empresa tiene el módulo activo pero no ha conectado ningún número. */
  estado: string | null;
  calidad: string | null;
  limiteDiarioMeta: number | null;
  margenSeguridad: number | null;
  numero: string | null;
  enviosActivos: boolean;
  iaActiva: boolean;
  ultimoWebhookAt: string | null;
  ultimoError: string | null;
  topeGastoCents: number | null;
  retencionDias: number | null;
  ultimoAviso: { campo: string; evento: string | null; at: string } | null;
  enviosHoy: number;
  fallidos24h: number;
  gasto: EstadoGasto | null;
  campanasActivas: number;
  campanasPausadas: number;
  eventosPendientes: number;
  eventosError: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Fila cruda de captacion_salud_empresas → FilaSalud. */
export function leerFilaSalud(r: unknown): FilaSalud {
  const f = (r && typeof r === "object" ? r : {}) as Obj;
  const tope = f.tope_gasto_mensual_cents == null ? null : num(f.tope_gasto_mensual_cents);
  return {
    companyId: String(f.company_id ?? ""),
    empresa: txt(f.empresa) ?? "(sin nombre)",
    estado: txt(f.estado),
    calidad: txt(f.calidad),
    limiteDiarioMeta: f.limite_diario_meta == null ? null : num(f.limite_diario_meta),
    margenSeguridad: f.margen_seguridad == null ? null : num(f.margen_seguridad),
    numero: txt(f.numero_e164),
    enviosActivos: f.envios_activos === true,
    iaActiva: f.ia_activa === true,
    ultimoWebhookAt: txt(f.ultimo_webhook_at),
    ultimoError: txt(f.ultimo_error),
    topeGastoCents: tope,
    retencionDias: f.retencion_dias == null ? null : num(f.retencion_dias),
    ultimoAviso: txt(f.ultimo_aviso_campo) && txt(f.ultimo_aviso_at)
      ? { campo: f.ultimo_aviso_campo, evento: txt(f.ultimo_aviso_evento), at: f.ultimo_aviso_at }
      : null,
    enviosHoy: num(f.envios_hoy),
    fallidos24h: num(f.fallidos_24h),
    gasto:
      tope == null
        ? null
        : evaluarGasto({ confirmadoMilicentimos: num(f.gasto_confirmado_milicentimos), enVuelo: num(f.gasto_en_vuelo), topeCents: tope }),
    campanasActivas: num(f.campanas_activas),
    campanasPausadas: num(f.campanas_pausadas),
    eventosPendientes: num(f.eventos_pendientes),
    eventosError: num(f.eventos_error),
  };
}

export type NivelSalud = "ok" | "aviso" | "error";

export interface AlertaSalud {
  nivel: Exclude<NivelSalud, "ok">;
  texto: string;
}

/** Días sin ningún aviso de Meta con la conexión activa a partir de los cuales se avisa. */
export const DIAS_SIN_WEBHOOK = 3;
/** Fallidos en 24 h a partir de los cuales es un error (por debajo, aviso). */
export const FALLIDOS_ERROR = 10;

const DIA_MS = 86_400_000;

export function alertasSalud(f: FilaSalud, ahora: Date): AlertaSalud[] {
  const out: AlertaSalud[] = [];
  if (!f.estado) out.push({ nivel: "aviso", texto: "Módulo activo sin número conectado." });
  else if (f.estado !== "activa") out.push({ nivel: "error", texto: `Conexión ${f.estado}.` });

  if (f.calidad === "roja") out.push({ nivel: "error", texto: "Calidad del número en rojo." });
  else if (f.calidad === "amarilla") out.push({ nivel: "aviso", texto: "Calidad del número en amarillo." });

  if (f.ultimoError) out.push({ nivel: "aviso", texto: `Último error: ${f.ultimoError}` });

  if (f.gasto?.nivel === "tope" && (f.topeGastoCents ?? 0) > 0) out.push({ nivel: "error", texto: "Tope de gasto del mes alcanzado." });
  else if (f.gasto?.nivel === "aviso") out.push({ nivel: "aviso", texto: "Gasto del mes por encima del 80 %." });

  if (f.fallidos24h >= FALLIDOS_ERROR) out.push({ nivel: "error", texto: `${f.fallidos24h} envíos fallidos en 24 h.` });
  else if (f.fallidos24h > 0) out.push({ nivel: "aviso", texto: `${f.fallidos24h} ${f.fallidos24h === 1 ? "envío fallido" : "envíos fallidos"} en 24 h.` });

  if (f.eventosError > 0) {
    out.push({ nivel: "error", texto: `${f.eventosError} ${f.eventosError === 1 ? "aviso de Meta con error" : "avisos de Meta con error"}.` });
  }
  if (f.eventosPendientes > 0) {
    out.push({ nivel: "aviso", texto: `${f.eventosPendientes} ${f.eventosPendientes === 1 ? "aviso de Meta sin procesar" : "avisos de Meta sin procesar"}.` });
  }

  if (f.campanasPausadas > 0) {
    out.push({ nivel: "aviso", texto: `${f.campanasPausadas} ${f.campanasPausadas === 1 ? "campaña en pausa" : "campañas en pausa"}.` });
  }

  if (f.estado === "activa") {
    const t = f.ultimoWebhookAt ? new Date(f.ultimoWebhookAt).getTime() : Number.NaN;
    if (!Number.isFinite(t)) out.push({ nivel: "aviso", texto: "Nunca ha llegado un aviso de Meta." });
    else if (ahora.getTime() - t > DIAS_SIN_WEBHOOK * DIA_MS) {
      out.push({ nivel: "aviso", texto: `Sin avisos de Meta desde ${haceTexto(f.ultimoWebhookAt, ahora)}.` });
    }
  }
  return out;
}

export function nivelSalud(alertas: AlertaSalud[]): NivelSalud {
  if (alertas.some((a) => a.nivel === "error")) return "error";
  return alertas.length > 0 ? "aviso" : "ok";
}

/** «hace 5 min», «hace 3 h», «hace 2 días»; «—» si no hay fecha. */
export function haceTexto(fecha: string | null | undefined, ahora: Date): string {
  if (!fecha) return "—";
  const t = new Date(fecha).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((ahora.getTime() - t) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} días`;
}

// -----------------------------------------------------------------------------
// Crons
// -----------------------------------------------------------------------------

export interface EjecucionCron {
  job: string;
  started_at: string;
  ended_at: string | null;
  ok: boolean | null;
  duration_ms: number | null;
  errors_count: number | null;
  summary: Record<string, unknown> | null;
}

export type EstadoCron = "ok" | "errores" | "fallo" | "sin_terminar" | "nunca";

/**
 * Estado de la última ejecución. `sin_terminar` = empezó y no se cerró (se
 * cortó por tiempo o murió); si lleva menos de `margenMin` minutos, se da por
 * en curso y cuenta como ok.
 */
export function estadoCron(e: EjecucionCron | null, ahora: Date, margenMin = 10): EstadoCron {
  if (!e) return "nunca";
  if (e.ok == null || !e.ended_at) {
    const t = new Date(e.started_at).getTime();
    return Number.isFinite(t) && ahora.getTime() - t < margenMin * 60_000 ? "ok" : "sin_terminar";
  }
  if (!e.ok) return "fallo";
  return (e.errors_count ?? 0) > 0 ? "errores" : "ok";
}

/** Claves del resumen que se enseñan (sin la lista de errores, que puede ser larga). */
export function resumenCron(summary: Record<string, unknown> | null): Array<[string, string]> {
  if (!summary || typeof summary !== "object") return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(summary)) {
    if (k === "errors") continue;
    if (v == null) continue;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") out.push([k, String(v)]);
    else if (typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === "number" || typeof v2 === "boolean" || typeof v2 === "string") out.push([`${k}.${k2}`, String(v2)]);
      }
    }
  }
  return out.slice(0, 24);
}
