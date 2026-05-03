"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Route, MapPin, ArrowDownToLine } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { planMyDayRoute, applyMyDayRouteAction, type DayRoutePlan } from "./actions";

const KIND_LABEL: Record<string, string> = {
  installation: "Instalación",
  maintenance: "Mantenimiento",
  agenda: "Agenda",
};

function formatKm(km: number): string {
  return `${km.toFixed(1)} km`;
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RoutePlannerButton() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<DayRoutePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function openAndPlan() {
    setOpen(true);
    setLoading(true);
    try {
      const p = await planMyDayRoute();
      setPlan(p);
    } catch (err) {
      notify.error("Error", err instanceof Error ? err.message : String(err));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!plan) return;
    const ids = plan.optimized.map((p) => p.id);
    startTransition(async () => {
      try {
        await applyMyDayRouteAction(ids, 60);
        notify.success("Ruta aplicada", "Las paradas se han reordenado");
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  const savings =
    plan && plan.currentKm > 0 ? plan.currentKm - plan.optimizedKm : 0;
  const savingsPct =
    plan && plan.currentKm > 0 ? (savings / plan.currentKm) * 100 : 0;

  return (
    <>
      <Button onClick={openAndPlan} variant="outline" className="gap-2">
        <Route className="h-4 w-4" /> Ordenar por proximidad
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Optimizar ruta del día</DialogTitle>
          </DialogHeader>

          {loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Calculando…
            </div>
          )}

          {!loading && plan && plan.optimized.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No hay paradas con coordenadas en tu día.
            </div>
          )}

          {!loading && plan && plan.optimized.length > 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-muted/30 p-3">
                  <div className="text-xs uppercase font-bold text-muted-foreground">
                    Orden actual
                  </div>
                  <div className="mt-1 text-xl font-extrabold">
                    {formatKm(plan.currentKm)}
                  </div>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3">
                  <div className="text-xs uppercase font-bold text-muted-foreground">
                    Optimizado
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-700">
                    {formatKm(plan.optimizedKm)}
                  </div>
                </div>
                <div className="rounded-xl bg-primary/5 p-3">
                  <div className="text-xs uppercase font-bold text-muted-foreground">
                    Ahorro
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-primary">
                    {savings > 0 ? `${formatKm(savings)} (${savingsPct.toFixed(0)}%)` : "—"}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> Partida: {plan.start.label}
                </div>
                <ol className="divide-y rounded-xl border">
                  {plan.optimized.map((p, idx) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{p.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {KIND_LABEL[p.kind] ?? p.kind} · {formatTime(p.scheduled_at)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {plan.withoutGeo.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-bold uppercase text-muted-foreground">
                    Sin coordenadas (no entran en el cálculo)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {plan.withoutGeo.map((p) => (
                      <Badge key={p.id} variant="outline">
                        {p.title}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Distancia en línea recta (Haversine). Por carretera será mayor.
                Al aplicar, las paradas se espacian cada 60 min desde la primera hora del día.
              </p>

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button onClick={apply} disabled={pending} variant="success" className="gap-2">
                  <ArrowDownToLine className="h-4 w-4" />
                  {pending ? "Aplicando…" : "Aplicar este orden"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
