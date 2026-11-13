import { Banknote, CheckCircle2, Info } from "lucide-react";
import type { MantVisita } from "./datos";
import { ETIQUETA_TARIFA, TARIFAS, eur, textoPrecio } from "./logica";

const METODO: Record<string, string> = {
  cash: "efectivo",
  card: "tarjeta",
  bizum: "Bizum",
  transfer: "transferencia",
  direct_debit: "domiciliación",
  financing: "financiación",
};

/**
 * Banner de cobro arriba de la visita (lo ve el técnico en el móvil):
 *  - pendiente → rojo «COBRAR ESTE MANTENIMIENTO» con las dos tarifas + IVA.
 *  - última incluida → ámbar: avisar al cliente de que el año que viene paga.
 *  - pagado en oficina / cobrado / sin cobrar → línea informativa.
 * Sin estado: server component.
 */
export function BannerCobroVisita({ visita, abierta }: { visita: MantVisita; abierta: boolean }) {
  const r = visita.resumen;
  const ef = visita.pagoEfectivo;

  if (ef === "pendiente") {
    const dif = visita.importePendienteCents;
    const esDiferencia = !!visita.pagadoOficina && dif != null;
    return (
      <div
        role="alert"
        className="rounded-2xl border-2 border-red-400 bg-red-50 p-4 text-red-900"
      >
        <p className="flex items-center gap-2 text-base font-extrabold uppercase tracking-wide">
          <Banknote className="h-5 w-5 shrink-0" aria-hidden="true" />
          {esDiferencia ? "Diferencia de membrana por cobrar" : abierta ? "Cobrar este mantenimiento" : "Mantenimiento por cobrar"}
        </p>
        {esDiferencia ? (
          <p className="mt-1 text-sm font-semibold">{textoPrecio(dif, r?.iva ?? 21)}</p>
        ) : r ? (
          <ul className="mt-2 space-y-1 text-sm">
            {TARIFAS.map((t) => (
              <li key={t} className="flex flex-wrap justify-between gap-x-3">
                <span className="font-semibold">{ETIQUETA_TARIFA[t]}</span>
                <span className="tabular-nums">{textoPrecio(r.aplicado[t].cents, r.iva)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {r?.anioPaga && !esDiferencia && (
          <p className="mt-2 text-xs">
            Los mantenimientos incluidos de este equipo terminaron
            {r.anioHasta ? ` con la visita de ${r.anioHasta}` : ""}: paga desde {r.anioPaga}.
          </p>
        )}
        {!abierta && visita.noCobradoMotivo && (
          <p className="mt-1 text-xs">Motivo del técnico: {visita.noCobradoMotivo}</p>
        )}
      </div>
    );
  }

  if (ef === "no_cobrado") {
    return (
      <div role="alert" className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p className="font-bold">Sin cobrar en la visita</p>
        {visita.importePendienteCents != null && (
          <p>{textoPrecio(visita.importePendienteCents, r?.iva ?? 21)}</p>
        )}
        {visita.noCobradoMotivo && <p className="text-xs">Motivo: {visita.noCobradoMotivo}</p>}
      </div>
    );
  }

  if (ef === "pagado_oficina") {
    const po = visita.pagadoOficina;
    return (
      <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Pagado en oficina
        {po?.tarifa ? ` · ${ETIQUETA_TARIFA[po.tarifa]}` : ""}
        {po?.cents != null ? ` · ${eur(po.cents)} + IVA` : ""}
        {po?.metodo ? ` · ${METODO[po.metodo] ?? po.metodo}` : ""}
      </p>
    );
  }

  if (ef === "cobrado_tecnico") {
    const c = visita.cobrado;
    return (
      <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Cobrado en la visita
        {c?.cents != null ? ` · ${eur(c.cents)}` : ""}
        {c?.metodo ? ` · ${METODO[c.metodo] ?? c.metodo}` : ""}
      </p>
    );
  }

  // Incluido: solo avisamos si es la última incluida y la visita está abierta.
  if (abierta && r?.estado === "ultima_incluida" && r.anioPaga) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <strong>Última revisión incluida.</strong> Avisa al cliente de que a partir de {r.anioPaga} los
          mantenimientos se pagan
          {r.aplicado.solo_filtros.cents != null
            ? ` (${eur(r.aplicado.solo_filtros.cents)} + IVA solo filtros)`
            : ""}
          .
        </p>
      </div>
    );
  }
  return null;
}
