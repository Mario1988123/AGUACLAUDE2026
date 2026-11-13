import type { PagoEstado } from "./logica";

const TEXTO: Record<Exclude<PagoEstado, "incluido">, string> = {
  pendiente: "A cobrar",
  no_cobrado: "Sin cobrar",
  pagado_oficina: "Pagado oficina",
  cobrado_tecnico: "Cobrado",
};

/**
 * Importe / estado de pago de una visita en listas. Sin estado: vale en server
 * y client components. `pago` null = migración sin aplicar → lo de siempre.
 */
export function EtiquetaPagoVisita({
  pago,
  isCharged,
  importe,
}: {
  pago: PagoEstado | null;
  isCharged: boolean;
  /** Importe ya formateado (o null). */
  importe: string | null;
}) {
  if (pago && pago !== "incluido") {
    const rojo = pago === "pendiente" || pago === "no_cobrado";
    return (
      <span
        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-bold ${
          rojo ? "bg-red-100 text-red-800" : "bg-emerald-50 text-emerald-800"
        }`}
      >
        {TEXTO[pago]}
        {isCharged && importe ? ` · ${importe}` : ""}
      </span>
    );
  }
  if (isCharged) return <strong className="tabular-nums">{importe ?? "—"}</strong>;
  return <span className="text-xs text-muted-foreground">Incluido</span>;
}
