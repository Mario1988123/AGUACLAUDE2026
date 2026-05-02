"use client";

import { useState, useTransition } from "react";
import {
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  startInstallation,
  pauseInstallation,
  resumeInstallation,
  reportDamageOrDrilling,
  completeInstallation,
} from "./actions";

interface Props {
  installationId: string;
  status: string;
  startedAt: string | null;
  hasPreviousDamage: boolean | null;
  needsCountertopDrilling: boolean | null;
  geoDistanceM: number | null;
  geoToleranceM?: number;
}

function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

export function InstallationWorkReport({
  installationId,
  status,
  startedAt,
  hasPreviousDamage,
  needsCountertopDrilling,
  geoDistanceM,
  geoToleranceM = 300,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [completing, setCompleting] = useState(false);
  const [completeNotes, setCompleteNotes] = useState("");

  const isInProgress = status === "in_progress";
  const isPaused = status === "paused";
  const isCompleted = status === "completed";
  const canStart = status === "scheduled" || status === "unscheduled";

  function handleStart() {
    startTransition(async () => {
      const geo = await getCurrentPosition();
      try {
        await startInstallation({
          id: installationId,
          geo_lat: geo?.lat,
          geo_lng: geo?.lng,
        });
        notify.success("Parte iniciado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function handlePause() {
    startTransition(async () => {
      try {
        await pauseInstallation(installationId);
        notify.info("Parte pausado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function handleResume() {
    startTransition(async () => {
      try {
        await resumeInstallation(installationId);
        notify.success("Parte reanudado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function reportDamage(value: boolean) {
    startTransition(async () => {
      try {
        await reportDamageOrDrilling({ installation_id: installationId, has_previous_damage: value });
        notify.success("Anotado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function reportDrilling(value: boolean) {
    startTransition(async () => {
      try {
        await reportDamageOrDrilling({
          installation_id: installationId,
          needs_countertop_drilling: value,
        });
        notify.success("Anotado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function doComplete() {
    startTransition(async () => {
      const geo = await getCurrentPosition();
      try {
        await completeInstallation({
          id: installationId,
          geo_lat: geo?.lat,
          geo_lng: geo?.lng,
          notes: completeNotes,
        });
        notify.success("¡Instalación completada!");
        setCompleting(false);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" /> Parte de trabajo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Geolocalización */}
        {geoDistanceM != null && (
          <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
              geoDistanceM > geoToleranceM
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-success bg-success/10 text-success"
            }`}
          >
            <MapPin className="h-4 w-4" />
            <span>
              Distancia a dirección: <strong>{geoDistanceM} m</strong>
              {geoDistanceM > geoToleranceM && " (fuera de rango — se generará incidencia)"}
            </span>
          </div>
        )}

        {/* Botones de control */}
        <div className="grid grid-cols-2 gap-3">
          {canStart && (
            <Button
              onClick={handleStart}
              disabled={pending}
              variant="success"
              size="lg"
              className="col-span-2"
            >
              <Play className="h-5 w-5" /> INICIAR PARTE
            </Button>
          )}
          {isInProgress && (
            <>
              <Button onClick={handlePause} disabled={pending} variant="warning" size="lg">
                <Pause className="h-5 w-5" /> Pausar
              </Button>
              <Button
                onClick={() => setCompleting(true)}
                disabled={pending}
                variant="success"
                size="lg"
              >
                <CheckCircle2 className="h-5 w-5" /> Finalizar
              </Button>
            </>
          )}
          {isPaused && (
            <Button
              onClick={handleResume}
              disabled={pending}
              variant="success"
              size="lg"
              className="col-span-2"
            >
              <Play className="h-5 w-5" /> Reanudar
            </Button>
          )}
          {isCompleted && (
            <div className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-success/10 p-4 font-bold text-success">
              <CheckCircle2 className="h-6 w-6" /> Parte completado
            </div>
          )}
        </div>

        {(isInProgress || isPaused) && (
          <>
            {/* Cuestionario */}
            <div className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
                <AlertTriangle className="h-4 w-4" /> Inspección
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">¿Hay daños previos?</span>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => reportDamage(true)}
                      disabled={pending}
                      variant={hasPreviousDamage === true ? "destructive" : "outline"}
                      size="sm"
                    >
                      Sí
                    </Button>
                    <Button
                      onClick={() => reportDamage(false)}
                      disabled={pending}
                      variant={hasPreviousDamage === false ? "success" : "outline"}
                      size="sm"
                    >
                      No
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">¿Hay que hacer agujero en encimera?</span>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => reportDrilling(true)}
                      disabled={pending}
                      variant={needsCountertopDrilling === true ? "warning" : "outline"}
                      size="sm"
                    >
                      Sí
                    </Button>
                    <Button
                      onClick={() => reportDrilling(false)}
                      disabled={pending}
                      variant={needsCountertopDrilling === false ? "success" : "outline"}
                      size="sm"
                    >
                      No
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Cronómetro */}
            {startedAt && (
              <div className="rounded-xl bg-primary/10 p-3 text-center text-sm">
                <Badge variant="default">
                  Iniciado {new Date(startedAt).toLocaleString("es-ES")}
                </Badge>
              </div>
            )}
          </>
        )}

        {/* Modal completar */}
        {completing && (
          <div className="space-y-3 rounded-xl border-2 border-success bg-success/5 p-4">
            <div className="font-semibold">Finalizar parte</div>
            <textarea
              value={completeNotes}
              onChange={(e) => setCompleteNotes(e.target.value)}
              rows={3}
              placeholder="Observaciones finales..."
              className="w-full rounded-xl border border-border bg-card p-3 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCompleting(false)}>
                Cancelar
              </Button>
              <Button variant="success" onClick={doComplete} disabled={pending}>
                Confirmar finalización
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
