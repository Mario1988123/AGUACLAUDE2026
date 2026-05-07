"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Plus, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  cancelMandateAction,
  createMandateRedirectFlowAction,
  type MandateListRow,
} from "./actions";

const STATUS_LABEL: Record<string, string> = {
  pending_submission: "Pendiente firma",
  submitted: "Enviado al banco",
  active: "Activo",
  cancelled: "Cancelado",
  failed: "Fallido",
  expired: "Expirado",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "destructive" | "outline"> = {
  pending_submission: "secondary",
  submitted: "secondary",
  active: "success",
  cancelled: "outline",
  failed: "destructive",
  expired: "outline",
};

export function CustomerMandatesPanel({
  customerId,
  mandates,
  configured,
}: {
  customerId: string;
  mandates: MandateListRow[];
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function startMandateFlow() {
    if (!configured) {
      notify.warning("GoCardless no está configurado", "Pídele a un admin que lo active en Configuración → GoCardless.");
      return;
    }
    startTransition(async () => {
      try {
        const { redirect_url } = await createMandateRedirectFlowAction({
          customer_id: customerId,
          return_path: `/clientes/${customerId}`,
        });
        // Abrir en pestaña nueva para que el usuario interno pueda enviar
        // el link al cliente (o redirigir si está con él al lado)
        window.open(redirect_url, "_blank", "noopener");
        notify.info("Link de firma generado", "Se ha abierto el formulario en una pestaña nueva. Envíalo al cliente para que firme.");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function cancel(id: string) {
    if (!confirm("¿Cancelar este mandato? El cliente dejará de poder ser cobrado por este IBAN.")) {
      return;
    }
    startTransition(async () => {
      try {
        await cancelMandateAction(id);
        notify.success("Mandato cancelado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-3">
      {mandates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Sin mandatos. Genera uno para poder domiciliar pagos.
        </p>
      )}
      {mandates.map((m) => (
        <div key={m.id} className="flex items-center justify-between rounded-xl border bg-card p-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">
                {m.bank_name ?? "Banco"} · ****{m.iban_last4 ?? "----"}
              </span>
              <Badge variant={STATUS_VARIANT[m.status] ?? "outline"}>
                {STATUS_LABEL[m.status] ?? m.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Creado {new Date(m.created_at).toLocaleDateString("es-ES")}
            </div>
          </div>
          {(m.status === "active" || m.status === "submitted" || m.status === "pending_submission") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancel(m.id)}
              disabled={pending}
              className="gap-1"
            >
              <X className="h-3 w-3" /> Cancelar
            </Button>
          )}
        </div>
      ))}
      <Button onClick={startMandateFlow} disabled={pending} variant="outline" className="w-full gap-2">
        <Plus className="h-4 w-4" /> Generar nuevo mandato
      </Button>
    </div>
  );
}
