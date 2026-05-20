"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ShieldAlert, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  exportCustomerDataAction,
  requestCustomerDeletionAction,
} from "./rgpd-actions";

export function CustomerRgpdCard({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const router = useRouter();

  function exportData() {
    startTransition(async () => {
      const r = await exportCustomerDataAction(customerId);
      if (!r.ok) {
        notify.error("No se pudo exportar", r.error);
        return;
      }
      // Descargar como JSON
      const blob = new Blob([JSON.stringify(r.payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rgpd-export-${customerId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify.success(
        "Datos exportados",
        "Se ha descargado el JSON con todos los datos del cliente.",
      );
    });
  }

  function confirmDelete() {
    if (confirmText !== "ANONIMIZAR") {
      notify.warning(
        "Escribe ANONIMIZAR para confirmar",
        "Esta acción anonimiza datos personales en cascada (cliente, direcciones, IBAN, fotos DNI).",
      );
      return;
    }
    if (!reason.trim()) {
      notify.warning("Motivo obligatorio");
      return;
    }
    startTransition(async () => {
      const r = await requestCustomerDeletionAction({
        customer_id: customerId,
        reason: reason.trim(),
      });
      if (!r.ok) {
        notify.error("No se pudo anonimizar", r.error);
        return;
      }
      notify.success(
        "Cliente anonimizado",
        "Datos personales borrados. Estructura fiscal conservada por obligación.",
      );
      setDeleteOpen(false);
      router.push("/clientes");
    });
  }

  return (
    <>
      <Card className="border-amber-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            RGPD · Derechos del cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Solo admin de empresa. El cliente puede ejercer sus derechos
            del Reglamento (UE) 2016/679 (art. 15 acceso, art. 17 olvido).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportData}
              disabled={pending}
              className="gap-1.5"
            >
              <Download className="h-4 w-4" />
              {pending ? "Exportando…" : "Exportar mis datos (art. 15)"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={pending}
              className="gap-1.5"
            >
              <ShieldAlert className="h-4 w-4" />
              Anonimizar (derecho al olvido)
            </Button>
          </div>
        </CardContent>
      </Card>

      {deleteOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3"
          onClick={() => !pending && setDeleteOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h2 className="text-base font-bold text-red-900">
                  ⚠ Anonimización RGPD — irreversible
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cliente:{" "}
                  <strong className="text-foreground">{customerName}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => !pending && setDeleteOpen(false)}
                className="rounded-full p-1 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-xs text-red-900">
                <p className="font-bold">Esta acción:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>Sustituye nombre/email/teléfono/DNI por [BORRADO].</li>
                  <li>Borra calle/portal/piso/coords (mantiene CP/ciudad).</li>
                  <li>Ofusca IBAN (mantiene 4+4 dígitos por contabilidad).</li>
                  <li>Elimina físicamente fotos DNI y documentos sensibles.</li>
                  <li>
                    NO toca facturas/contratos (obligación fiscal: 6 años).
                  </li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <Label>Motivo (obligatorio, queda en el log)</Label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej: solicitud del cliente por email el 20/05/2026"
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Escribe <code className="font-bold">ANONIMIZAR</code> para
                  confirmar
                </Label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="ANONIMIZAR"
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t p-3">
              <Button
                variant="outline"
                onClick={() => setDeleteOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={pending || confirmText !== "ANONIMIZAR" || !reason.trim()}
              >
                {pending ? "Anonimizando…" : "Anonimizar ahora"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
