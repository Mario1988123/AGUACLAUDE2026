"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  saveWarehouseSettingsAction,
  type WarehouseSettings,
} from "./settings-actions";

interface Props {
  initial: WarehouseSettings;
}

export function WarehouseSettingsForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [valuation, setValuation] = useState<"PMP" | "FIFO">(
    initial.valuation_method,
  );
  const [noRot, setNoRot] = useState(String(initial.alert_no_rotation_days));
  const [minAge, setMinAge] = useState(
    String(initial.alert_min_company_age_days),
  );
  const [iva, setIva] = useState(String(initial.default_iva_pct));
  const [enabled, setEnabled] = useState(initial.alerts_enabled);

  function submit() {
    startTransition(async () => {
      const r = await saveWarehouseSettingsAction({
        valuation_method: valuation,
        alert_no_rotation_days: Number(noRot),
        alert_min_company_age_days: Number(minAge),
        default_iva_pct: Number(iva),
        alerts_enabled: enabled,
      });
      if (!r.ok) {
        notify.error("No se guardó", r.error);
        return;
      }
      notify.success("Configuración guardada");
      router.refresh();
    });
  }

  function toggle(key: keyof WarehouseSettings["alerts_enabled"]) {
    setEnabled((e) => ({ ...e, [key]: !e[key] }));
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <h3 className="font-bold">Valoración del inventario</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Método</Label>
            <select
              value={valuation}
              onChange={(e) => setValuation(e.target.value as "PMP" | "FIFO")}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="PMP">PMP (Promedio Móvil Ponderado)</option>
              <option value="FIFO">FIFO (Primera Entrada, Primera Salida)</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              PMP recalcula coste medio con cada compra. FIFO usa lotes por
              orden de recepción.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">IVA por defecto en compras (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={iva}
              onChange={(e) => setIva(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <h3 className="font-bold">Política de alertas</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Días sin rotación para alerta</Label>
            <Input
              type="number"
              min={1}
              value={noRot}
              onChange={(e) => setNoRot(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Si un producto no sale en X días, salta &quot;sin rotación&quot;.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Edad mínima de la empresa para activar (días)
            </Label>
            <Input
              type="number"
              min={0}
              value={minAge}
              onChange={(e) => setMinAge(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Si tu empresa lleva menos de X días en el CRM, no se generan
              alertas de rotación (evita falsos positivos).
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Tipos de alerta activos</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["below_min", "Stock por debajo del mínimo"],
                ["predictive_low", "Predicción de rotura próxima"],
                ["over_max", "Stock por encima del máximo"],
                ["no_rotation_90d", "Sin rotación X días"],
                ["no_lead_time_set", "Producto sin plazo reposición"],
              ] as const
            ).map(([k, label]) => (
              <label
                key={k}
                className="flex items-center gap-2 rounded-lg border p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={enabled[k]}
                  onChange={() => toggle(k)}
                  className="h-4 w-4"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending} variant="success" className="gap-2">
          <Save className="h-4 w-4" />
          {pending ? "Guardando..." : "Guardar configuración"}
        </Button>
      </div>
    </div>
  );
}
