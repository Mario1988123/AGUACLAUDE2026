"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Replace, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { sustituirParteDelPackAction } from "./sustituir-parte-actions";

/**
 * «Sustituir esta parte» de un pack con complemento (Horeca + ósmosis/UF).
 * Equipo físico nuevo: mismo modelo con otro número de serie, u otro modelo
 * del mismo tipo. El pack se conserva. No confundir con «Corregir modelo».
 */
export function BotonSustituirParte({
  equipoId,
  nombre,
  productIdActual,
  opciones,
}: {
  equipoId: string;
  nombre: string;
  productIdActual: string | null;
  /** Modelos del mismo tipo que la parte que sale. */
  opciones: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(productIdActual ?? opciones[0]?.id ?? "");
  const [serie, setSerie] = useState("");
  const [motivo, setMotivo] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function cerrar() {
    setOpen(false);
    setProductId(productIdActual ?? opciones[0]?.id ?? "");
    setSerie("");
    setMotivo("");
  }

  function guardar() {
    startTransition(async () => {
      const r = await sustituirParteDelPackAction({
        equipo_id: equipoId,
        product_id: productId,
        serial_number: serie || null,
        motivo,
      });
      if (!r.ok) {
        notify.error("No se pudo sustituir", r.error);
        return;
      }
      if (r.aviso_stock) notify.warning("Parte sustituida", r.aviso_stock);
      else notify.success("Parte sustituida");
      cerrar();
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Replace className="h-4 w-4" />
        Sustituir esta parte
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={cerrar}
        >
          <div
            className="w-full space-y-4 rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-bold">Sustituir esta parte</h2>
                <p className="text-xs text-muted-foreground">
                  {nombre}. Se pone un equipo nuevo y el pack se mantiene; el que sale queda como
                  baja en el historial.
                </p>
              </div>
              <button
                type="button"
                onClick={cerrar}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              <Label>Equipo nuevo</Label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
              >
                {opciones.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.id === productIdActual ? " (el mismo modelo)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Nº de serie del equipo nuevo</Label>
              <Input value={serie} onChange={(e) => setSerie(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                Obligatorio si es el mismo modelo.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <textarea
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej. avería de la bomba"
                className="w-full rounded-xl border border-input bg-background p-2 text-base"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              El equipo nuevo se descuenta de tu furgoneta o, si no tienes, del almacén principal.
              El que sale no vuelve solo al stock.
            </p>
            <Button
              type="button"
              size="lg"
              className="h-12 w-full"
              disabled={pending || !productId || motivo.trim().length < 3}
              onClick={guardar}
            >
              {pending ? "Guardando..." : "Sustituir"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
