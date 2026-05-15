"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Calendar } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  upsertVacationWindowAction,
  deleteVacationWindowAction,
  type VacationWindow,
} from "./vacation-windows-actions";

interface Props {
  windows: VacationWindow[];
  year: number;
}

export function VacationWindowsManager({ windows, year }: Props) {
  const router = useRouter();
  const ask = useConfirm();
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const [cap, setCap] = useState("");

  function submit() {
    if (!from || !to || !label.trim()) {
      notify.warning("Indica fechas y etiqueta");
      return;
    }
    if (new Date(to) < new Date(from)) {
      notify.warning("Fecha fin antes que inicio");
      return;
    }
    startTransition(async () => {
      const r = await upsertVacationWindowAction({
        starts_on: from,
        ends_on: to,
        label: label.trim(),
        max_concurrent_users: cap ? Number(cap) : null,
      });
      if (!r.ok) {
        notify.error("No se pudo crear", r.error);
        return;
      }
      notify.success("Ventana creada");
      setFrom("");
      setTo("");
      setLabel("");
      setCap("");
      router.refresh();
    });
  }

  async function remove(id: string, lbl: string) {
    const ok = await ask({
      message: `¿Eliminar la ventana "${lbl}"?`,
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteVacationWindowAction(id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Eliminada");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define los rangos en los que tus empleados pueden pedir vacaciones de
        más de 2 días seguidos. Días sueltos (1-2 días) se permiten siempre,
        fuera de ventana.
      </p>

      {/* Form alta */}
      <div className="grid gap-3 sm:grid-cols-5 rounded-xl border bg-background p-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Etiqueta</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ej. Verano 2026"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Aforo (opcional)</Label>
          <Input
            type="number"
            min={1}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            placeholder="Sin tope"
          />
        </div>
        <div className="sm:col-span-5 flex justify-end">
          <Button onClick={submit} disabled={pending} className="gap-2">
            <Plus className="h-4 w-4" /> Crear ventana
          </Button>
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-1">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Ventanas {year} ({windows.length})
        </h3>
        {windows.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            Sin ventanas definidas. Crea al menos una para que el equipo pueda
            pedir vacaciones largas (p.ej. verano, navidad, semana santa).
          </div>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {windows.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-amber-100 p-1.5 text-amber-700">
                    <Calendar className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-bold">{w.label}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {new Date(w.starts_on).toLocaleDateString("es-ES")} →{" "}
                      {new Date(w.ends_on).toLocaleDateString("es-ES")}
                      {w.max_concurrent_users != null && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                          Máx {w.max_concurrent_users}{" "}
                          {w.max_concurrent_users === 1 ? "persona" : "personas"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => remove(w.id, w.label)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
