import { ChipModeloEquipo } from "./chip-modelo";
import { TIPO_LABEL } from "./logica";
import type { ResumenRuta } from "./ruta";

/**
 * «Qué equipos te tocan» para cargar la furgoneta: fuentes y ósmosis por
 * modelo, hoy y mañana. Los que están sin identificar no suman: se atienden
 * con la reserva de la furgoneta (decisión 16). Móvil primero.
 */
export function ResumenRutaCard({ titulo, r }: { titulo: string; r: ResumenRuta }) {
  const sin = r.sinIdentificar;
  const totalSin = sin.fuente + sin.osmosis + sin.desconocido;
  const nada = r.totalMantenimientos === 0 && r.totalInstalaciones === 0;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">{titulo}</h2>
        <span className="text-xs text-muted-foreground">
          {r.totalMantenimientos} mant. · {r.totalInstalaciones} inst.
        </span>
      </div>
      {nada && <p className="text-sm text-muted-foreground">Nada programado.</p>}
      {r.instalaciones.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Equipos a instalar
          </p>
          <ul className="space-y-1.5">
            {r.instalaciones.map((l) => (
              <li key={l.etiqueta} className="flex items-center justify-between gap-2">
                <ChipModeloEquipo etiqueta={l.etiqueta} pendiente={false} tipo={l.tipo} />
                <span className="shrink-0 font-mono text-sm font-bold">×{l.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.mantenimientos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Mantenimientos
          </p>
          <ul className="space-y-1.5">
            {r.mantenimientos.map((l) => (
              <li key={l.etiqueta} className="flex items-center justify-between gap-2">
                <ChipModeloEquipo etiqueta={l.etiqueta} pendiente={l.pendiente} tipo={l.tipo} />
                <span className="shrink-0 font-mono text-sm font-bold">×{l.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {totalSin > 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{totalSin} sin identificar</strong>
          {" ("}
          {[
            sin.fuente ? `${sin.fuente} ${TIPO_LABEL.fuente.toLowerCase()}` : null,
            sin.osmosis ? `${sin.osmosis} ${TIPO_LABEL.osmosis.toLowerCase()}` : null,
            sin.desconocido ? `${sin.desconocido} de tipo desconocido` : null,
          ]
            .filter(Boolean)
            .join(", ")}
          {"). "}
          Se atienden con la reserva de la furgoneta; identifícalos en la visita.
        </p>
      )}
    </section>
  );
}
