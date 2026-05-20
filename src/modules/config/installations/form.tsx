"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { saveInstallationsConfigSafeAction } from "./actions";

export function InstallationsConfigForm({
  initial,
}: {
  initial: { geo_tolerance_m: number; time_tolerance_min: number };
}) {
  const [geo, setGeo] = useState(initial.geo_tolerance_m);
  const [time, setTime] = useState(initial.time_tolerance_min);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const r = await saveInstallationsConfigSafeAction({
        installation_geo_tolerance_m: geo,
        installation_time_tolerance_min: time,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Configuración guardada");
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Tolerancia GPS al iniciar parte (metros)</Label>
        <Input
          type="number"
          min={50}
          max={5000}
          value={geo}
          onChange={(e) => setGeo(Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Si el técnico está a más metros del cliente al pulsar «Iniciar parte»,
          se notifica a admin/director técnico (no bloquea).
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Tolerancia hora programada (minutos)</Label>
        <Input
          type="number"
          min={5}
          max={240}
          value={time}
          onChange={(e) => setTime(Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Margen para considerar el parte «iniciado a tiempo».
        </p>
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" /> {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
