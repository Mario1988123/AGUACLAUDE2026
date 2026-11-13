import type { ResumenMant } from "./datos";
import { eur } from "./logica";

/**
 * Estado del mantenimiento incluido de un equipo. Sin estado: vale en server y
 * client components.
 *  - a_pagar → franja roja a todo el ancho, en mayúsculas.
 *  - última incluida → chip ámbar.
 *  - incluido / alquiler → chip verde discreto.
 *  - sin dato (solo venta) → chip gris.
 */
export function ChipMantIncluido({ mant }: { mant: ResumenMant }) {
  if (!mant.texto) return null;
  if (mant.estado === "a_pagar") {
    const p = mant.aplicado.solo_filtros.cents;
    const pm = mant.aplicado.filtros_membrana.cents;
    return (
      <div className="w-full rounded-lg bg-red-600 px-3 py-2 text-white">
        <p className="text-sm font-extrabold uppercase tracking-wide">
          Empezar a pagar — desde {mant.anioPaga}
        </p>
        {(p != null || pm != null) && (
          <p className="text-xs font-semibold">
            {[
              p != null ? `Solo filtros ${eur(p)} + IVA` : null,
              pm != null ? `Filtros + membrana ${eur(pm)} + IVA` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    );
  }
  const color =
    mant.estado === "ultima_incluida"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : mant.estado === "sin_dato"
        ? "border-border bg-muted text-muted-foreground"
        : "border-emerald-200 bg-emerald-50 text-emerald-800";
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}
    >
      <span className="break-words">{mant.texto}</span>
    </span>
  );
}
