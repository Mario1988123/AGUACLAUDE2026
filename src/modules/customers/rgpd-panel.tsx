"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ShieldOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  exportCustomerDataAction,
  requestCustomerDeletionAction,
} from "./rgpd-actions";

interface Props {
  customerId: string;
  customerName: string;
}

export function CustomerRGPDPanel({ customerId, customerName }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ask = useConfirm();

  function exportData() {
    startTransition(async () => {
      const r = await exportCustomerDataAction(customerId);
      if (!r.ok) {
        notify.error("No se pudo exportar", r.error);
        return;
      }
      // Generar y descargar JSON
      const blob = new Blob([JSON.stringify(r.payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cliente-${customerId.slice(0, 8)}-rgpd-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify.success("Datos exportados", "Se ha descargado el archivo JSON");
    });
  }

  async function confirmDelete() {
    if (reason.trim().length < 5) {
      notify.warning("Indica un motivo de al menos 5 caracteres");
      return;
    }
    const ok = await ask({
      title: "Confirmar borrado RGPD",
      message: `Vas a anonimizar definitivamente los datos personales de "${customerName}".\n\nNombre, email, teléfono y CIF/DNI quedarán como "[BORRADO]" y NULL respectivamente. Las facturas, contratos e instalaciones se mantienen por obligación fiscal (AEAT, 6 años).\n\n¿Continuar?`,
      confirmText: "Anonimizar definitivamente",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await requestCustomerDeletionAction({
        customer_id: customerId,
        reason: reason.trim(),
      });
      if (!r.ok) {
        notify.error("No se pudo borrar", r.error);
        return;
      }
      notify.success("Cliente anonimizado");
      setDeleteOpen(false);
      router.push("/clientes" as never);
    });
  }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          🛡 RGPD — Datos personales
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Acciones RGPD para este cliente. El export descarga un JSON con
          todos sus datos personales y movimientos (art. 15). El borrado
          anonimiza la información PII pero mantiene los registros fiscales
          obligatorios (art. 17 con matiz AEAT).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportData}
            disabled={pending}
            className="gap-2"
          >
            <Download className="h-4 w-4" /> Exportar mis datos
          </Button>
          {!deleteOpen ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={pending}
              className="gap-2"
            >
              <ShieldOff className="h-4 w-4" /> Solicitar borrado
            </Button>
          ) : null}
        </div>
        {deleteOpen && (
          <div className="space-y-2 rounded-xl border-2 border-destructive/30 bg-destructive/5 p-3">
            <div className="text-xs font-bold text-destructive">
              Motivo del borrado *
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Ej. cliente solicita ejercicio derecho al olvido por escrito"
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDeleteOpen(false);
                  setReason("");
                }}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={confirmDelete}
                disabled={pending}
              >
                {pending ? "Procesando…" : "Anonimizar"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
