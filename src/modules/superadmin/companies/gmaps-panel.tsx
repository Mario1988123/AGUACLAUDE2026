"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { setCompanyGmapsSafeAction } from "./actions";

type Mode = "disabled" | "shared_key" | "own_key";

interface Props {
  companyId: string;
  initial: {
    mode: Mode;
    monthly_cap_usd: number;
    daily_cap_usd: number;
  };
  /** Resumen consumo mes actual de la empresa (USD) — solo informativo. */
  current_month_usd?: number;
}

const MODE_LABEL: Record<Mode, string> = {
  disabled: "Desactivado",
  shared_key: "Clave compartida (pagas tú)",
  own_key: "Clave propia (paga la empresa)",
};

const MODE_DESC: Record<Mode, string> = {
  disabled:
    "Sin acceso al módulo Google Maps Tools. Funciona OSM/Leaflet/Nominatim como hasta ahora.",
  shared_key:
    "La empresa usa tu API key de plataforma (NEXT_PUBLIC_GOOGLE_MAPS_KEY + GOOGLE_MAPS_PLATFORM_SERVER_KEY). Tú pagas la factura a Google y cobras vía cuota mensual. Útil para empresas pequeñas con bajo consumo donde el $200 free tier de Google cubre todo.",
  own_key:
    "La empresa configura su propia API key en /configuracion/google-maps. La factura va directa a su tarjeta de Google Cloud. Recomendado para empresas medianas/grandes (>$50/mes de uso).",
};

export function CompanyGmapsPanel({
  companyId,
  initial,
  current_month_usd,
}: Props) {
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [monthlyCap, setMonthlyCap] = useState<string>(
    String(initial.monthly_cap_usd ?? 50),
  );
  const [dailyCap, setDailyCap] = useState<string>(
    String(initial.daily_cap_usd ?? 10),
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    startTransition(async () => {
      const r = await setCompanyGmapsSafeAction({
        company_id: companyId,
        mode,
        monthly_cap_usd: Number(monthlyCap),
        daily_cap_usd: Number(dailyCap),
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Google Maps Tools actualizado");
      router.refresh();
    });
  }

  const exceeded =
    current_month_usd != null &&
    current_month_usd >= Number(monthlyCap);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold">
          Modo actual: <strong>{MODE_LABEL[initial.mode]}</strong>
        </span>
      </div>

      <div className="space-y-2">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <label
            key={m}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition ${
              mode === m
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <input
              type="radio"
              name="gmaps_mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="mt-1"
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm">{MODE_LABEL[m]}</span>
                {m === "shared_key" && (
                  <Badge variant="warning" className="text-[10px]">
                    Coste platform
                  </Badge>
                )}
                {m === "own_key" && (
                  <Badge variant="success" className="text-[10px]">
                    Coste empresa
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {MODE_DESC[m]}
              </p>
            </div>
          </label>
        ))}
      </div>

      {mode !== "disabled" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Tope diario (USD)</Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Si el consumo del día llega aquí, el módulo cae a OSM hasta
              mañana. Default $10.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Tope mensual (USD)</Label>
            <Input
              type="number"
              min={0}
              step="5"
              value={monthlyCap}
              onChange={(e) => setMonthlyCap(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Tope absoluto del mes. Default $50.
            </p>
          </div>
        </div>
      )}

      {current_month_usd != null && initial.mode !== "disabled" && (
        <div
          className={`rounded-xl border p-3 text-xs ${
            exceeded
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border bg-muted/30"
          }`}
        >
          Consumo este mes: <strong>${current_month_usd.toFixed(2)}</strong> de
          ${initial.monthly_cap_usd.toFixed(2)} ({Math.round((current_month_usd * 100) / initial.monthly_cap_usd)}%)
          {exceeded && " · TOPE ALCANZADO"}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success" className="gap-2">
          <Save className="h-4 w-4" />
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
