"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Plus, X, RefreshCw, Download } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  cancelMandateAction,
  createMandateRedirectFlowAction,
  syncCustomerMandatesAction,
  importMandateByIdAction,
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
  const [importOpen, setImportOpen] = useState(false);
  const [mandateIdInput, setMandateIdInput] = useState("");

  function sync() {
    startTransition(async () => {
      const r = await syncCustomerMandatesAction(customerId);
      if (!r.ok) {
        notify.error("No se pudo sincronizar", r.error);
        return;
      }
      notify.success("Sincronizado con GoCardless", r.message);
      router.refresh();
    });
  }

  function importById() {
    const id = mandateIdInput.trim();
    if (!id) {
      notify.warning("Pega el ID del mandato (empieza por MD…)");
      return;
    }
    startTransition(async () => {
      const r = await importMandateByIdAction({
        customer_id: customerId,
        gocardless_mandate_id: id,
      });
      if (!r.ok) {
        notify.error("No se pudo importar", r.error);
        return;
      }
      notify.success("Importado", r.message);
      setImportOpen(false);
      setMandateIdInput("");
      router.refresh();
    });
  }

  function startMandateFlow() {
    if (!configured) {
      notify.warning("GoCardless no está configurado", "Pídele a un admin que lo active en Configuración → GoCardless.");
      return;
    }
    startTransition(async () => {
      const result = await createMandateRedirectFlowAction({
        customer_id: customerId,
        return_path: `/clientes/${customerId}`,
      });
      if (!result.ok) {
        notify.error("No se pudo generar el mandato", result.error);
        return;
      }
      window.open(result.redirect_url, "_blank", "noopener");
      notify.info(
        "Link de firma generado",
        "Se ha abierto el formulario en una pestaña nueva. Envíalo al cliente para que firme.",
      );
    });
  }

  function cancel(id: string) {
    if (!confirm("¿Cancelar este mandato? El cliente dejará de poder ser cobrado por este IBAN.")) {
      return;
    }
    startTransition(async () => {
      const result = await cancelMandateAction(id);
      if (!result.ok) {
        notify.error("No se pudo cancelar", result.error);
        return;
      }
      notify.success("Mandato cancelado");
      router.refresh();
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
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={startMandateFlow} disabled={pending} className="gap-2" variant="outline">
          <Plus className="h-4 w-4" /> Generar nuevo mandato
        </Button>
        <Button onClick={sync} disabled={pending} variant="outline" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          Sincronizar con GoCardless
        </Button>
      </div>
      <Button
        onClick={() => setImportOpen(true)}
        disabled={pending}
        variant="ghost"
        size="sm"
        className="w-full gap-2 text-xs"
      >
        <Download className="h-3 w-3" /> Importar mandato por ID (MD…)
      </Button>

      {importOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setImportOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              <h2 className="text-base font-bold">Importar mandato por ID</h2>
              <p className="text-xs text-muted-foreground">
                Si has creado un mandato directamente en el dashboard de GoCardless, pega aquí el ID
                (empieza por MD…) y lo añadimos a este cliente.
              </p>
              <div className="space-y-1">
                <Label>ID del mandato</Label>
                <Input
                  value={mandateIdInput}
                  onChange={(e) => setMandateIdInput(e.target.value)}
                  placeholder="MD000ABC123…"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setImportOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={importById} disabled={pending}>
                Importar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
