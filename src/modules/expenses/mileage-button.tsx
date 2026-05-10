"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, MapPin, Calculator, Clock, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { createMileageAction } from "./actions";
import { calculateRouteAction } from "./routing-actions";

export function MileageButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [calculating, setCalculating] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    origin: "",
    destination: "",
    km: 0,
    duration_minutes: 0,
    vehicle_plate: "",
    notes: "",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function calculate() {
    if (!form.origin.trim() || !form.destination.trim()) {
      notify.warning("Indica origen y destino");
      return;
    }
    setCalculating(true);
    try {
      const r = await calculateRouteAction(form.origin, form.destination);
      if (!r) {
        notify.error(
          "No se pudo calcular",
          "Comprueba las direcciones. Puedes meter los km a mano.",
        );
        return;
      }
      set("km", r.km);
      set("duration_minutes", r.duration_minutes);
      notify.success(`Calculado: ${r.km} km · ${r.duration_minutes} min`);
    } finally {
      setCalculating(false);
    }
  }

  function save() {
    if (form.km <= 0) {
      notify.warning("Indica los km (calcula la ruta o métela a mano)");
      return;
    }
    startTransition(async () => {
      try {
        await createMileageAction({
          date: form.date,
          origin: form.origin || null,
          destination: form.destination || null,
          km: form.km,
          vehicle_plate: form.vehicle_plate || null,
          notes: form.notes || null,
        });
        notify.success("Kilometraje registrado");
        setOpen(false);
        setForm({
          date: new Date().toISOString().slice(0, 10),
          origin: "",
          destination: "",
          km: 0,
          duration_minutes: 0,
          vehicle_plate: "",
          notes: "",
        });
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Car className="h-4 w-4" /> Kilometraje
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Registrar kilometraje</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> Origen
              </Label>
              <Input
                value={form.origin}
                onChange={(e) => set("origin", e.target.value)}
                placeholder="Ej. Calle Mayor 12, Madrid"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> Destino
              </Label>
              <Input
                value={form.destination}
                onChange={(e) => set("destination", e.target.value)}
                placeholder="Ej. Avda Andalucía 45, Sevilla"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={calculate}
              disabled={calculating || pending}
              className="w-full"
            >
              <Calculator className="h-4 w-4" />
              {calculating ? "Calculando..." : "Calcular km en carretera (OSRM)"}
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Km</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.km || ""}
                  onChange={(e) => set("km", Number(e.target.value))}
                  placeholder="0"
                />
              </div>
              {form.duration_minutes > 0 && (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" /> Duración estimada
                  </Label>
                  <div className="flex h-10 items-center rounded-md border border-input bg-muted/30 px-3 text-sm tabular-nums">
                    {Math.floor(form.duration_minutes / 60)}h{" "}
                    {form.duration_minutes % 60}m
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Matrícula vehículo</Label>
              <Input
                value={form.vehicle_plate}
                onChange={(e) => set("vehicle_plate", e.target.value)}
                placeholder="0000 ABC"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
                placeholder="Cliente visitado, motivo, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending} variant="success">
              <Plus className="h-4 w-4" /> {pending ? "Guardando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
