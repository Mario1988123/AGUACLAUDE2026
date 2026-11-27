import "server-only";
import { admin } from "./servidor";
import { inicioDiaMadrid, inicioMesMadrid } from "./mando-logica";
import { alertasSalud, leerFilaSalud, nivelSalud, type AlertaSalud, type EjecucionCron, type FilaSalud, type NivelSalud } from "./salud-logica";

/**
 * Datos del panel de salud de captación para Vercomi (fase 8). Solo lo llama
 * /superadmin/captacion, que comprueba antes que la sesión es de superadmin.
 * Cliente de servicio: aquí se ven TODAS las empresas a propósito.
 */

export const CRONS_CAPTACION = ["captacion-envios", "captacion-diario"] as const;

export interface CampanaPausadaSalud {
  id: string;
  companyId: string;
  nombre: string;
  motivo: string | null;
  automatica: boolean;
  pausadaAt: string | null;
}

export interface CronSalud {
  job: string;
  ultima: EjecucionCron | null;
  ultimoFallo: EjecucionCron | null;
}

export interface DatosSalud {
  generadoAt: string;
  empresas: Array<FilaSalud & { alertas: AlertaSalud[]; nivel: NivelSalud; pausadas: CampanaPausadaSalud[] }>;
  /** Eventos de webhook que no se pudieron atar a ninguna empresa (phone_number_id desconocido). */
  eventosSinEmpresa: number;
  eventosSinEmpresa24h: number;
  crons: CronSalud[];
  errores: string[];
}

const COLUMNAS_CRON = "job, started_at, ended_at, ok, duration_ms, errors_count, summary";

export async function datosSaludCaptacion(ahora = new Date()): Promise<DatosSalud> {
  const db = admin();
  const errores: string[] = [];
  const hace24h = new Date(ahora.getTime() - 86_400_000).toISOString();

  const [filas, sinEmpresa, sinEmpresa24h, pausadas, ...crons] = await Promise.all([
    db.rpc("captacion_salud_empresas", {
      p_hoy_desde: inicioDiaMadrid(ahora).toISOString(),
      p_mes_desde: inicioMesMadrid(ahora).toISOString(),
    }),
    db.from("captacion_webhook_eventos").select("id", { count: "exact", head: true }).is("company_id", null),
    db
      .from("captacion_webhook_eventos")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .gte("recibido_at", hace24h),
    db
      .from("captacion_campanas")
      .select("id, company_id, nombre, motivo_pausa, pausa_automatica, pausada_at")
      .eq("estado", "pausada")
      .order("pausada_at", { ascending: false, nullsFirst: false })
      .limit(500),
    ...CRONS_CAPTACION.flatMap((job) => [
      db.from("cron_runs").select(COLUMNAS_CRON).eq("job", job).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      db
        .from("cron_runs")
        .select(COLUMNAS_CRON)
        .eq("job", job)
        .eq("ok", false)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]),
  ]);

  if (filas.error) errores.push(`empresas: ${filas.error.message}`);
  if (sinEmpresa.error) errores.push(`eventos sin empresa: ${sinEmpresa.error.message}`);
  if (pausadas.error) errores.push(`campañas en pausa: ${pausadas.error.message}`);

  const porEmpresa = new Map<string, CampanaPausadaSalud[]>();
  for (const c of (pausadas.data ?? []) as Array<{
    id: string;
    company_id: string;
    nombre: string;
    motivo_pausa: string | null;
    pausa_automatica: boolean;
    pausada_at: string | null;
  }>) {
    porEmpresa.set(c.company_id, [
      ...(porEmpresa.get(c.company_id) ?? []),
      { id: c.id, companyId: c.company_id, nombre: c.nombre, motivo: c.motivo_pausa, automatica: c.pausa_automatica, pausadaAt: c.pausada_at },
    ]);
  }

  const empresas = ((filas.data ?? []) as unknown[]).map((r) => {
    const f = leerFilaSalud(r);
    const alertas = alertasSalud(f, ahora);
    return { ...f, alertas, nivel: nivelSalud(alertas), pausadas: porEmpresa.get(f.companyId) ?? [] };
  });
  // Lo peor arriba.
  const peso: Record<NivelSalud, number> = { error: 0, aviso: 1, ok: 2 };
  empresas.sort((a, b) => peso[a.nivel] - peso[b.nivel] || a.empresa.localeCompare(b.empresa, "es"));

  const cronsSalud: CronSalud[] = CRONS_CAPTACION.map((job, i) => {
    const ultima = crons[i * 2]!;
    const fallo = crons[i * 2 + 1]!;
    if (ultima.error) errores.push(`cron ${job}: ${ultima.error.message}`);
    return {
      job,
      ultima: (ultima.data as EjecucionCron | null) ?? null,
      ultimoFallo: (fallo.data as EjecucionCron | null) ?? null,
    };
  });

  return {
    generadoAt: ahora.toISOString(),
    empresas,
    eventosSinEmpresa: sinEmpresa.count ?? 0,
    eventosSinEmpresa24h: sinEmpresa24h.count ?? 0,
    crons: cronsSalud,
    errores,
  };
}
