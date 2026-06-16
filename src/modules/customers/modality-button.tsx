"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { setEquipmentModalityAction } from "./equipment-actions";

type Plan = "cash" | "rental" | "renting";
const LABEL: Record<Plan, string> = {
  cash: "Venta",
  rental: "Alquiler",
  renting: "Renting",
};

function fmtEur(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/**
 * Badge + editor de la MODALIDAD de un equipo (venta/alquiler/renting +
 * importe + fecha inicio). Permite completar/cambiar el dato desde la ficha
 * sin recargar el Excel.
 */
export function EquipmentModalityButton({
  equipmentId,
  current,
}: {
  equipmentId: string;
  current: {
    type: Plan | null;
    amount_cents: number | null;
    started_at: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<"" | Plan>(current.type ?? "");
  const [amount, setAmount] = useState(
    current.amount_cents != null
      ? (current.amount_cents / 100).toString().replace(".", ",")
      : "",
  );
  const [started, setStarted] = useState(
    current.started_at ? current.started_at.slice(0, 10) : "",
  );

  function save() {
    startTransition(async () => {
      const cents = amount.trim()
        ? Math.round(parseFloat(amount.replace(",", ".")) * 100)
        : null;
      const r = await setEquipmentModalityAction({
        equipment_id: equipmentId,
        acquisition_type: type || null,
        acquisition_amount_cents:
          cents != null && Number.isFinite(cents) ? cents : null,
        acquisition_started_at: started || null,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Modalidad guardada");
      setOpen(false);
      router.refresh();
    });
  }

  const badge =
    current.type != null ? (
      <>
        {LABEL[current.type]}
        {current.amount_cents != null && ` · ${fmtEur(current.amount_cents)}`}
      </>
    ) : (
      "Modalidad"
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Editar modalidad (venta/alquiler/renting)"
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
          current.type
            ? "border-violet-200 bg-violet-50 text-violet-800"
            : "border-dashed border-border bg-muted/30 text-muted-foreground"
        }`}
      >
        <Tag className="h-3 w-3" />
        {badge}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold">Modalidad del equipo</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cómo tiene el cliente este equipo. Por ahora es informativo (los
              contratos llegan en la Fase 2).
            </p>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Modalidad</Label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as "" | Plan)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  <option value="cash">Venta</option>
                  <option value="rental">Alquiler</option>
                  <option value="renting">Renting</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Importe (€{type === "cash" ? " venta" : type ? "/mes" : ""})
                  </Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="29,90"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fecha inicio</Label>
                  <Input
                    type="date"
                    value={started}
                    onChange={(e) => setStarted(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
