"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Ban } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  issueInvoiceV2Action,
  cancelInvoiceV2Action,
} from "./verifactu-actions";

interface Props {
  invoiceId: string;
  status: string;
}

export function VerifactuV2Actions({ invoiceId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ask = useConfirm();

  async function issue() {
    const ok = await ask({
      title: "Emitir factura con Verifactu",
      message:
        "Esta acción asigna número correlativo, calcula el hash Verifactu encadenado y genera el QR. La factura queda INMUTABLE — no podrás editar líneas ni datos después. ¿Continuar?",
      confirmText: "Emitir",
      variant: "default",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await issueInvoiceV2Action(invoiceId);
      if (!r.ok) {
        notify.error("No se pudo emitir", r.error);
        return;
      }
      notify.success("Factura emitida con Verifactu");
      router.refresh();
    });
  }

  async function cancel() {
    if (reason.trim().length < 3) {
      notify.warning("Indica un motivo de al menos 3 caracteres");
      return;
    }
    const ok = await ask({
      title: "Anular factura Verifactu",
      message:
        "Se generará un registro Verifactu de anulación encadenado. La factura no se borra — queda marcada como anulada. ¿Continuar?",
      confirmText: "Anular",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await cancelInvoiceV2Action(invoiceId, reason.trim());
      if (!r.ok) {
        notify.error("No se pudo anular", r.error);
        return;
      }
      notify.success("Factura anulada");
      setCancelOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-blue-200 bg-blue-50/40 p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-blue-900">
        Verifactu (RD 1007/2023)
      </div>
      {status === "draft" && (
        <Button
          onClick={issue}
          disabled={pending}
          variant="default"
          size="sm"
          className="w-full gap-2"
        >
          <Send className="h-4 w-4" />
          {pending ? "Emitiendo…" : "Emitir con Verifactu"}
        </Button>
      )}
      {(status === "issued" || status === "sent_to_aeat" || status === "accepted_aeat") && (
        <>
          {!cancelOpen ? (
            <Button
              onClick={() => setCancelOpen(true)}
              disabled={pending}
              variant="destructive"
              size="sm"
              className="w-full gap-2"
            >
              <Ban className="h-4 w-4" />
              Anular factura
            </Button>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">Motivo de anulación *</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. error en datos del cliente"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCancelOpen(false);
                    setReason("");
                  }}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={cancel}
                  disabled={pending}
                >
                  {pending ? "Anulando…" : "Confirmar anulación"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="text-[11px] text-blue-800">
        Verifactu firma cada factura con hash encadenado al anterior y
        genera QR escaneable. Una vez emitida es inmutable; cambios
        requieren rectificativa o anulación formal.
      </p>
    </div>
  );
}
