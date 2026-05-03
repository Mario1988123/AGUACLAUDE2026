"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  addHolidayAction,
  deleteHolidayAction,
  setCompanyRegionAction,
  type HolidayRow,
} from "./holidays-actions";

interface Props {
  holidays: HolidayRow[];
  currentRegion: string | null;
  regions: Array<{ code: string; name: string }>;
  recommended: Array<{ date: string; name: string }>;
}

export function HolidaysManager({ holidays, currentRegion, regions, recommended }: Props) {
  const [region, setRegion] = useState(currentRegion ?? "");
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function saveRegion() {
    startTransition(async () => {
      try {
        await setCompanyRegionAction(region);
        notify.success("Provincia guardada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function add(date: string, name: string) {
    startTransition(async () => {
      try {
        await addHolidayAction({ date, name, region_code: region || undefined });
        notify.success("Festivo añadido");
        setNewDate("");
        setNewName("");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function remove(id: string) {
    if (!confirm("¿Eliminar este festivo? (los nacionales no se pueden borrar)")) return;
    startTransition(async () => {
      try {
        await deleteHolidayAction(id);
        notify.success("Eliminado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  const existingDates = new Set(holidays.map((h) => h.holiday_date));
  const pendingRecommended = recommended.filter((r) => !existingDates.has(r.date));

  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
        <Label>Provincia / comunidad de la empresa</Label>
        <div className="flex gap-2">
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="h-12 flex-1 rounded-xl border border-input bg-background px-3 text-base"
          >
            <option value="">— Sin definir —</option>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          <Button
            onClick={saveRegion}
            disabled={pending || region === (currentRegion ?? "")}
            variant="success"
          >
            Guardar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Marcando tu provincia te recomendaremos sus festivos autonómicos.
        </p>
      </div>

      {pendingRecommended.length > 0 && (
        <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-4">
          <h3 className="text-sm font-bold text-primary mb-2">
            Festivos recomendados para tu provincia
          </h3>
          <ul className="space-y-1.5">
            {pendingRecommended.map((r) => (
              <li key={r.date} className="flex items-center justify-between text-sm">
                <span>
                  <strong>{new Date(r.date).toLocaleDateString("es-ES")}</strong> · {r.name}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => add(r.date, r.name)}
                  disabled={pending}
                >
                  + Añadir
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 rounded-xl border bg-background p-4">
        <div className="space-y-1.5">
          <Label>Fecha</Label>
          <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Nombre del festivo</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </div>
        <div className="sm:col-span-3 flex justify-end">
          <Button
            onClick={() => {
              if (!newDate || !newName) {
                notify.warning("Indica fecha y nombre");
                return;
              }
              add(newDate, newName);
            }}
            disabled={pending}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Añadir festivo
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Festivos del año ({holidays.length})
        </h3>
        <ul className="divide-y rounded-xl border bg-card">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="font-bold tabular-nums">
                  {new Date(h.holiday_date).toLocaleDateString("es-ES", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </span>{" "}
                · {h.name}{" "}
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {h.scope}
                </Badge>
              </div>
              {!h.is_global && (
                <button
                  onClick={() => remove(h.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
