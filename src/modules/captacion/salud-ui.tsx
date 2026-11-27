import { StatusPill } from "@/shared/components/status-pill";
import { formatoEuros } from "./mando-logica";
import { estadoCron, haceTexto, resumenCron, type EstadoCron, type NivelSalud } from "./salud-logica";
import type { DatosSalud } from "./salud-servidor";

/**
 * Panel de salud de captación para Vercomi (fase 8). Componente de servidor.
 * Móvil primero: a 390 px, una tarjeta por empresa; desde lg, además, la
 * tabla con una fila por empresa. Lo peor va arriba.
 */

type Empresa = DatosSalud["empresas"][number];

const FECHA = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

function fecha(f: string | null | undefined): string {
  if (!f) return "—";
  const d = new Date(f);
  return Number.isFinite(d.getTime()) ? FECHA.format(d) : "—";
}

const NIVEL: Record<NivelSalud, { label: string; tone: "success" | "onhold" | "rejected" }> = {
  ok: { label: "Bien", tone: "success" },
  aviso: { label: "Revisar", tone: "onhold" },
  error: { label: "Mal", tone: "rejected" },
};

const CRON: Record<EstadoCron, { label: string; tone: "success" | "onhold" | "rejected" | "neutral" }> = {
  ok: { label: "Bien", tone: "success" },
  errores: { label: "Con errores", tone: "onhold" },
  fallo: { label: "Falló", tone: "rejected" },
  sin_terminar: { label: "Sin terminar", tone: "rejected" },
  nunca: { label: "Nunca", tone: "neutral" },
};

const CALIDAD: Record<string, string> = { verde: "Verde", amarilla: "Amarilla", roja: "Roja", desconocida: "Sin dato" };

function textoGasto(e: Empresa): string {
  if (!e.gasto) return "—";
  const pct = e.gasto.porcentaje == null ? "" : ` · ${Math.floor(e.gasto.porcentaje)} %`;
  return `${formatoEuros(e.gasto.comprometidoMilicentimos)} de ${formatoEuros(e.gasto.topeCents * 1000)}${pct}`;
}

function textoAviso(e: Empresa, ahora: Date): string {
  if (!e.ultimoAviso) return "—";
  return `${e.ultimoAviso.campo}${e.ultimoAviso.evento ? ` · ${e.ultimoAviso.evento}` : ""} (${haceTexto(e.ultimoAviso.at, ahora)})`;
}

function Dato({ k, v, fuerte = false }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{k}</dt>
      <dd className={`min-w-0 break-words text-right text-sm tabular-nums ${fuerte ? "font-bold" : ""}`}>{v}</dd>
    </div>
  );
}

function Pausadas({ e }: { e: Empresa }) {
  if (e.pausadas.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm">
      {e.pausadas.map((c) => (
        <li key={c.id} className="break-words">
          <span className="font-medium">{c.nombre}</span>
          <span className="text-muted-foreground">
            {" "}
            · {c.automatica ? "automática" : "a mano"}
            {c.motivo ? ` · ${c.motivo}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Alertas({ e }: { e: Empresa }) {
  if (e.alertas.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm">
      {e.alertas.map((a, i) => (
        <li key={i} className={a.nivel === "error" ? "font-medium text-destructive" : "text-foreground"}>
          {a.nivel === "error" ? "● " : "○ "}
          {a.texto}
        </li>
      ))}
    </ul>
  );
}

function TarjetaEmpresa({ e, ahora }: { e: Empresa; ahora: Date }) {
  return (
    <article className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold">{e.empresa}</h3>
          <p className="text-sm text-muted-foreground tabular-nums">{e.numero ?? "Sin número"}</p>
        </div>
        <StatusPill {...NIVEL[e.nivel]} className="shrink-0" />
      </header>
      <Alertas e={e} />
      <dl className="divide-y divide-border border-t border-border">
        <Dato k="Conexión" v={`${e.estado ?? "—"}${e.estado === "activa" && !e.enviosActivos ? " · frío apagado" : ""}`} />
        <Dato k="Calidad" v={e.calidad ? (CALIDAD[e.calidad] ?? e.calidad) : "—"} />
        <Dato k="Límite de Meta" v={e.limiteDiarioMeta == null ? "—" : `${e.limiteDiarioMeta} al día (margen ${e.margenSeguridad ?? 0})`} />
        <Dato k="Envíos hoy" v={String(e.enviosHoy)} fuerte />
        <Dato k="Fallidos 24 h" v={String(e.fallidos24h)} />
        <Dato k="Gasto del mes" v={textoGasto(e)} />
        <Dato k="Campañas" v={`${e.campanasActivas} activas · ${e.campanasPausadas} en pausa`} />
        <Dato k="Avisos de Meta" v={`${e.eventosPendientes} sin procesar · ${e.eventosError} con error`} />
        <Dato k="Último aviso de Meta" v={textoAviso(e, ahora)} />
        <Dato k="Último webhook" v={haceTexto(e.ultimoWebhookAt, ahora)} />
        <Dato k="Último error" v={e.ultimoError ?? "—"} />
      </dl>
      <Pausadas e={e} />
    </article>
  );
}

function TablaEmpresas({ empresas, ahora }: { empresas: Empresa[]; ahora: Date }) {
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const td = "px-3 py-2.5 align-top text-sm";
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[1100px] border-collapse">
        <thead className="border-b border-border">
          <tr>
            <th className={th}>Empresa</th>
            <th className={th}>Conexión</th>
            <th className={th}>Calidad · límite</th>
            <th className={th}>Hoy</th>
            <th className={th}>Fallidos 24 h</th>
            <th className={th}>Gasto del mes</th>
            <th className={th}>Campañas en pausa</th>
            <th className={th}>Avisos de Meta</th>
            <th className={th}>Alertas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {empresas.map((e) => (
            <tr key={e.companyId}>
              <td className={td}>
                <div className="font-bold">{e.empresa}</div>
                <div className="tabular-nums text-muted-foreground">{e.numero ?? "Sin número"}</div>
                <StatusPill {...NIVEL[e.nivel]} className="mt-1" />
              </td>
              <td className={td}>
                <div>{e.estado ?? "—"}</div>
                <div className="text-muted-foreground">{e.enviosActivos ? "frío encendido" : "frío apagado"}</div>
                <div className="text-muted-foreground">webhook {haceTexto(e.ultimoWebhookAt, ahora)}</div>
              </td>
              <td className={td}>
                <div>{e.calidad ? (CALIDAD[e.calidad] ?? e.calidad) : "—"}</div>
                <div className="tabular-nums text-muted-foreground">
                  {e.limiteDiarioMeta == null ? "—" : `${e.limiteDiarioMeta}/día · margen ${e.margenSeguridad ?? 0}`}
                </div>
              </td>
              <td className={`${td} tabular-nums font-bold`}>{e.enviosHoy}</td>
              <td className={`${td} tabular-nums`}>{e.fallidos24h}</td>
              <td className={`${td} tabular-nums`}>{textoGasto(e)}</td>
              <td className={td}>
                {e.pausadas.length ? <Pausadas e={e} /> : <span className="text-muted-foreground">Ninguna</span>}
              </td>
              <td className={td}>
                <div className="tabular-nums">
                  {e.eventosPendientes} sin procesar · {e.eventosError} con error
                </div>
                <div className="text-muted-foreground">{textoAviso(e, ahora)}</div>
              </td>
              <td className={`${td} max-w-[280px]`}>
                {e.alertas.length ? <Alertas e={e} /> : <span className="text-muted-foreground">—</span>}
                {e.ultimoError ? <div className="mt-1 break-words text-xs text-muted-foreground">{e.ultimoError}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PanelSaludCaptacion({ datos }: { datos: DatosSalud }) {
  const ahora = new Date(datos.generadoAt);
  return (
    <div className="space-y-6">
      {datos.errores.length > 0 ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-bold text-destructive">No se ha podido leer todo:</p>
          <ul className="mt-1 list-disc pl-5">
            {datos.errores.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Crons</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {datos.crons.map((c) => {
            const estado = estadoCron(c.ultima, ahora);
            const resumen = resumenCron(c.ultima?.summary ?? null);
            return (
              <article key={c.job} className="space-y-2 rounded-xl border border-border bg-card p-4">
                <header className="flex items-center justify-between gap-3">
                  <h3 className="font-mono text-sm font-bold">{c.job}</h3>
                  <StatusPill {...CRON[estado]} />
                </header>
                <dl className="divide-y divide-border border-t border-border">
                  <Dato k="Última" v={c.ultima ? `${fecha(c.ultima.started_at)} (${haceTexto(c.ultima.started_at, ahora)})` : "—"} />
                  <Dato k="Duración" v={c.ultima?.duration_ms != null ? `${Math.round(c.ultima.duration_ms / 1000)} s` : "—"} />
                  <Dato k="Errores" v={String(c.ultima?.errors_count ?? 0)} />
                  <Dato k="Último fallo" v={c.ultimoFallo ? fecha(c.ultimoFallo.started_at) : "Ninguno"} />
                </dl>
                {resumen.length > 0 ? (
                  <details className="text-sm">
                    <summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Resumen de la última</summary>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
                      {resumen.map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="break-all font-mono text-xs text-muted-foreground">{k}</dt>
                          <dd className="text-right text-xs">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Empresas con el módulo activo</h2>
          <p className="text-sm tabular-nums text-muted-foreground">
            Avisos de Meta sin empresa: {datos.eventosSinEmpresa} ({datos.eventosSinEmpresa24h} en 24 h)
          </p>
        </div>
        {datos.empresas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna empresa tiene el módulo de captación activo.</p>
        ) : (
          <>
            <div className="space-y-3 lg:hidden">
              {datos.empresas.map((e) => (
                <TarjetaEmpresa key={e.companyId} e={e} ahora={ahora} />
              ))}
            </div>
            <div className="hidden lg:block">
              <TablaEmpresas empresas={datos.empresas} ahora={ahora} />
            </div>
          </>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Datos de {fecha(datos.generadoAt)}. «Hoy» y «mes» en hora de Madrid. El gasto incluye lo enviado que aún no tiene
        estado de entrega, a tarifa de marketing.
      </p>
    </div>
  );
}
