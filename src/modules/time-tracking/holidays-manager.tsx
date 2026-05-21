"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  addHolidaySafeAction,
  deleteHolidaySafeAction,
  setCompanyLocalitySafeAction,
  type HolidayRow,
} from "./holidays-actions";
import type { Province } from "./localities";

interface Props {
  holidays: HolidayRow[];
  currentCCAA: string | null;
  currentCity: string | null;
  provinces: Province[];
  ccaaLabels: Record<string, string>;
  recommended: Array<{ date: string; name: string }>;
}

export function HolidaysManager({
  holidays,
  currentCCAA,
  currentCity,
  provinces,
  ccaaLabels,
  recommended,
}: Props) {
  const [ccaa, setCcaa] = useState(currentCCAA ?? "");
  const [city, setCity] = useState(currentCity ?? "");
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  // Provincias agrupadas por CCAA (para el selector)
  const provincesOfCCAA = useMemo(
    () => (ccaa ? provinces.filter((p) => p.ccaa === ccaa) : []),
    [ccaa, provinces],
  );
  const allCities = useMemo(
    () =>
      provincesOfCCAA.flatMap((p) =>
        p.cities.map((c) => ({ ...c, province: p.name })),
      ),
    [provincesOfCCAA],
  );

  function saveLocality() {
    startTransition(async () => {
      const r = await setCompanyLocalitySafeAction({
        ccaa: ccaa || null,
        city_code: city || null,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Localidad guardada");
      router.refresh();
    });
  }

  function add(date: string, name: string) {
    startTransition(async () => {
      const r = await addHolidaySafeAction({
        date,
        name,
        region_code: ccaa || undefined,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Festivo añadido");
      setNewDate("");
      setNewName("");
      router.refresh();
    });
  }

  async function remove(id: string) {
    const ok = await ask({
      message: "¿Eliminar este festivo? Los nacionales no se pueden borrar.",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteHolidaySafeAction(id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Eliminado");
      router.refresh();
    });
  }

  const existingDates = new Set(holidays.map((h) => h.holiday_date));
  const pendingRecommended = recommended.filter((r) => !existingDates.has(r.date));
  const dirty = ccaa !== (currentCCAA ?? "") || city !== (currentCity ?? "");

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Comunidad autónoma</Label>
            <select
              value={ccaa}
              onChange={(e) => {
                setCcaa(e.target.value);
                setCity(""); // reset ciudad al cambiar CCAA
              }}
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
            >
              <option value="">— Sin definir —</option>
              {Object.entries(ccaaLabels).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Ciudad (opcional)</Label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!ccaa}
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base disabled:opacity-50"
            >
              <option value="">— Sin ciudad / Solo nacionales y autonómicos —</option>
              {provincesOfCCAA.map((p) => (
                <optgroup key={p.code} label={p.name}>
                  {p.cities.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {ccaa && allCities.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay ciudades en el catálogo. Si tu empresa está en un
                pueblo, déjalo en blanco y añade los festivos a mano abajo.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={saveLocality}
            disabled={pending || !dirty}
            variant="success"
          >
            Guardar localidad
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Al seleccionar comunidad + ciudad, te sugerimos los festivos
          autonómicos y locales conocidos para 2026.
        </p>
      </div>

      {pendingRecommended.length > 0 && (
        <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-4">
          <h3 className="text-sm font-bold text-primary mb-2">
            Festivos recomendados para tu localidad
          </h3>
          <ul className="space-y-1.5">
            {pendingRecommended.map((r) => (
              <li
                key={`${r.date}-${r.name}`}
                className="flex items-center justify-between text-sm"
              >
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
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ej. Patrón del pueblo"
          />
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
                  {h.scope === "national"
                    ? "Nacional"
                    : h.scope === "region"
                      ? "Autonómico"
                      : "Empresa"}
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
