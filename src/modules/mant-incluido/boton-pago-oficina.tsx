"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Undo2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { marcarVisitaPagadaAction, quitarPagadoVisitaAction } from "./actions";
import { ETIQUETA_TARIFA, TARIFAS, centimosAEuros, eurosACentimos, type PreciosTarifa, type Tarifa } from "./logica";

const METODOS = [
  ["cash", "Efectivo"],
  ["card", "Tarjeta"],
  ["bizum", "Bizum"],
  ["transfer", "Transferencia"],
  ["direct_debit", "Domiciliación"],
] as const;

/**
 * «Marcar como pagado» de la oficina (hoja inferior en móvil). Tarifa, importe
 * y forma de pago son opcionales. No crea factura ni línea de wallet [decide]:
 * la oficina ya registra el cobro por su lado.
 */
export function BotonPagoOficina({
  jobId,
  modo,
  precios,
}: {
  jobId: string;
  /** marcar = visita a cobrar o sin cobrar; quitar = ya marcada y abierta. */
  modo: "marcar" | "quitar";
  precios: PreciosTarifa;
}) {
  const [abierto, setAbierto] = useState(false);
  const [tarifa, setTarifa] = useState<Tarifa | null>(null);
  const [importe, setImporte] = useState("");
  const [metodo, setMetodo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (modo === "quitar") {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await quitarPagadoVisitaAction(jobId);
            if (!r.ok) {
              notify.error("No se pudo quitar", r.error);
              return;
            }
            notify.success("Marca de pagado quitada");
            location.reload();
          })
        }
      >
        <Undo2 className="h-4 w-4" /> Quitar «pagado en oficina»
      </Button>
    );
  }

  function elegir(t: Tarifa) {
    setTarifa(t);
    if (precios[t] != null) setImporte(centimosAEuros(precios[t]));
  }

  function guardar() {
    const cents = importe.trim() ? eurosACentimos(importe) : null;
    if (importe.trim() && cents == null) {
      notify.warning("El importe no es válido", "Escribe por ejemplo 75 o 75,50");
      return;
    }
    start(async () => {
      const r = await marcarVisitaPagadaAction({ job_id: jobId, tarifa, cents, metodo });
      if (!r.ok) {
              notify.error("No se pudo marcar como pagado", r.error);
              return;
            }
      notify.success("Marcado como pagado en oficina", "El técnico ya no verá el aviso de cobro.");
      location.reload();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <CheckCircle2 className="h-4 w-4" /> Marcar como pagado
      </Button>
      {abierto && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-3"
          onClick={() => setAbierto(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pago-oficina-titulo"
            className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h2 id="pago-oficina-titulo" className="text-base font-bold">
                  Pagado en oficina
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Todo es opcional. Si pones la tarifa y el técnico hace filtros + membrana, se le pedirá la
                  diferencia.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="space-y-2">
                <Label>Tarifa pagada</Label>
                <div className="grid grid-cols-2 gap-2">
                  {TARIFAS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => elegir(t)}
                      aria-pressed={tarifa === t}
                      className={`min-h-12 rounded-xl border-2 px-2 text-sm font-bold ${
                        tarifa === t ? "border-primary bg-primary/10 text-primary" : "border-border"
                      }`}
                    >
                      {ETIQUETA_TARIFA[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pago-oficina-importe">Importe pagado SIN IVA (€)</Label>
                <Input
                  id="pago-oficina-importe"
                  inputMode="decimal"
                  value={importe}
                  onChange={(e) => setImporte(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pago-oficina-metodo">Forma de pago</Label>
                <select
                  id="pago-oficina-metodo"
                  value={metodo ?? ""}
                  onChange={(e) => setMetodo(e.target.value || null)}
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm"
                >
                  <option value="">Sin indicar</option>
                  {METODOS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button className="w-full" size="lg" onClick={guardar} disabled={pending}>
                {pending ? "Guardando..." : "Marcar como pagado"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
