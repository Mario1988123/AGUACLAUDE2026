"use client";

/**
 * Modal emergente con avisos operativos de una instalación, mismo patrón
 * que CustomerAlertsModal pero centrado en la realidad de la operación:
 *  - Retrasada (scheduled_at pasada)
 *  - En curso > 4 h (started_at antiguo, no completada)
 *  - Sin técnico asignado
 *  - Incidencia abierta
 *
 * Se renderiza al cargar /instalaciones/[id] si tiene alguna alerta.
 * No usa sessionStorage (sale siempre que haya algo abierto).
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  installationId: string;
  alerts: string[];
}

export function InstallationAlertsModal({ installationId, alerts }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (alerts.length === 0) return;
    setOpen(true);
  }, [installationId, alerts.length]);

  if (alerts.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            Avisos operativos ({alerts.length})
          </DialogTitle>
          <DialogDescription>
            Esta instalación tiene asuntos que conviene revisar antes de
            gestionarla.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li
              key={i}
              className="rounded-xl border-2 border-red-200 bg-red-50/50 p-3 text-sm font-semibold text-red-900"
            >
              {a}
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Entendido, ir a la ficha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
