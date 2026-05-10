"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UtensilsCrossed, Bed, Plus } from "lucide-react";
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
import { createPerDiemAction } from "./actions";

interface SettingsAmounts {
  national_overnight_cents: number;
  national_no_overnight_cents: number;
  eu_overnight_cents: number;
  eu_no_overnight_cents: number;
}

function formatEur(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

export function PerDiemButton({ amounts }: { amounts: SettingsAmounts }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    with_overnight: false,
    scope: "national" as "national" | "eu" | "international",
    destination: "",
    trip_purpose: "",
    notes: "",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function exemptCents(): number {
    if (form.scope === "national") {
      return form.with_overnight
        ? amounts.national_overnight_cents
        : amounts.national_no_overnight_cents;
    }
    return form.with_overnight
      ? amounts.eu_overnight_cents
      : amounts.eu_no_overnight_cents;
  }

  function save() {
    startTransition(async () => {
      try {
        await createPerDiemAction({
          date: form.date,
          with_overnight: form.with_overnight,
          scope: form.scope,
          destination: form.destination || null,
          trip_purpose: form.trip_purpose || null,
          notes: form.notes || null,
        });
        notify.success("Dieta registrada");
        setOpen(false);
        setForm({
          date: new Date().toISOString().slice(0, 10),
          with_overnight: false,
          scope: "national",
          destination: "",
          trip_purpose: "",
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
        <UtensilsCrossed className="h-4 w-4" /> Dieta
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Registrar dieta</DialogTitle>
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
              <Label>Tipo de dieta</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => set("with_overnight", false)}
                  className={`flex items-center gap-2 rounded-xl border-2 p-3 text-sm font-bold ${
                    !form.with_overnight
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <UtensilsCrossed className="h-4 w-4" />
                  Sin pernocta
                </button>
                <button
                  type="button"
                  onClick={() => set("with_overnight", true)}
                  className={`flex items-center gap-2 rounded-xl border-2 p-3 text-sm font-bold ${
                    form.with_overnight
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <Bed className="h-4 w-4" />
                  Con pernocta
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Ámbito</Label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { v: "national" as const, l: "España" },
                    { v: "eu" as const, l: "UE" },
                    { v: "international" as const, l: "Internacional" },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => set("scope", opt.v)}
                    className={`rounded-xl border-2 p-2 text-sm font-bold ${
                      form.scope === opt.v
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-emerald-900">
                  Importe exento IRPF
                </span>
                <span className="text-xl font-extrabold text-emerald-700 tabular-nums">
                  {formatEur(exemptCents())}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-emerald-800">
                Cap por día. Lo que supere se considera salario y tributa.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Destino</Label>
              <Input
                value={form.destination}
                onChange={(e) => set("destination", e.target.value)}
                placeholder="Ej. Sevilla"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Motivo del viaje</Label>
              <Input
                value={form.trip_purpose}
                onChange={(e) => set("trip_purpose", e.target.value)}
                placeholder="Ej. Visita cliente XYZ"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
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
