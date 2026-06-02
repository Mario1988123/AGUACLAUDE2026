"use client";

/**
 * Modal emergente que muestra automáticamente los avisos abiertos de un
 * cliente al abrir su ficha. Si no hay avisos no se renderiza nada.
 *
 * Pensado para que el comercial vea de un vistazo qué pasa con el cliente
 * antes de empezar a trabajar (mantenimiento vencido, incidencia, etc.).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { AlertTriangle, ExternalLink } from "lucide-react";
import type { CustomerAlertDetail } from "./actions";

interface Props {
  customerId: string;
  alerts: CustomerAlertDetail[];
}

export function CustomerAlertsModal({ customerId, alerts }: Props) {
  const [open, setOpen] = useState(false);

  // Abrir automáticamente al cargar SIEMPRE que haya avisos. Decisión
  // 2026-06-02: la versión inicial usaba sessionStorage "1 vez al día"
  // pero quedaba bloqueado tras la primera visita. Si en el futuro se
  // vuelve molesto, añadir un toggle "no volver a mostrar" en el footer
  // del modal.
  useEffect(() => {
    if (alerts.length === 0) return;
    setOpen(true);
  }, [customerId, alerts.length]);

  if (alerts.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            Avisos abiertos ({alerts.length})
          </DialogTitle>
          <DialogDescription>
            Este cliente tiene asuntos pendientes. Revísalos antes de hacer
            cualquier gestión.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li
              key={i}
              className="rounded-xl border-2 border-red-200 bg-red-50/50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-red-900">{a.title}</div>
                  <div className="text-sm text-red-800">{a.detail}</div>
                </div>
                {a.href && (
                  <Link
                    href={a.href as never}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border bg-card px-2 text-xs font-semibold hover:bg-muted"
                    onClick={() => setOpen(false)}
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    Ver
                  </Link>
                )}
              </div>
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
