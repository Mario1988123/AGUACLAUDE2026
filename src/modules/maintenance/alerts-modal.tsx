"use client";

/**
 * Modal emergente con avisos operativos de un mantenimiento, mismo patrón
 * que InstallationAlertsModal / CustomerAlertsModal pero centrado en la
 * realidad del mantenimiento:
 *  - Retrasado (scheduled_at pasada, sin completar)
 *  - En curso > 4 h (started_at antiguo)
 *  - Sin técnico asignado
 *  - Pendiente de devolver llamada
 *  - Visita propuesta no confirmada con el cliente
 *
 * Se renderiza al cargar /mantenimientos/[id] si hay alguna alerta.
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
  maintenanceId: string;
  alerts: string[];
}

export function MaintenanceAlertsModal({ maintenanceId, alerts }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (alerts.length === 0) return;
    setOpen(true);
  }, [maintenanceId, alerts.length]);

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
            Este mantenimiento tiene asuntos que conviene revisar antes de
            gestionarlo.
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
