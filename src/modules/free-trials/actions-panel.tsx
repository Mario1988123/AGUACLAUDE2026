"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  X,
  Check,
  FileSignature,
  FileDown,
  Wrench,
  PackageMinus,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { rejectFreeTrialSafeAction, acceptFreeTrialAction } from "./actions";
import { SignAndInstallButton } from "./sign-install-modal";
import {
  ScheduleUninstallButton,
  type WarehouseOption,
  type InstallerOption,
} from "./uninstall-modal";

interface PendingUninstall {
  id: string;
  status: string;
  reference_code: string | null;
  scheduled_at: string | null;
}

export function FreeTrialActionsPanel({
  trialId,
  status,
  isProvisional,
  customerName,
  customerTaxId,
  warehouses,
  installers,
  pendingUninstall,
}: {
  trialId: string;
  status: string;
  isProvisional?: boolean;
  customerName: string;
  customerTaxId: string | null;
  warehouses: WarehouseOption[];
  installers: InstallerOption[];
  pendingUninstall: PendingUninstall | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  function reject() {
    if (!reason.trim()) {
      notify.warning("Indica motivo de rechazo");
      return;
    }
    startTransition(async () => {
      const r = await rejectFreeTrialSafeAction(trialId, reason);
      if (!r.ok) {
        notify.error("No se pudo rechazar", r.error);
        return;
      }
      notify.success(
        "Marcada como rechazada",
        "Agenda la desinstalación para retirar el equipo.",
      );
      router.refresh();
    });
  }

  function accept() {
    startTransition(async () => {
      const r = await acceptFreeTrialAction({ trial_id: trialId });
      if (!r.ok) {
        notify.error("No se pudo aceptar", r.error);
        return;
      }
      notify.success(
        "Prueba aceptada",
        "Contrato creado en borrador. Te llevamos a la ficha del contrato.",
      );
      router.push(`/contratos/${r.contract_id}` as never);
    });
  }

  // ---------- Estados terminales ----------
  if (status === "removed") {
    return (
      <p className="text-sm text-muted-foreground">
        Equipo retirado. Sin acciones disponibles.
      </p>
    );
  }
  if (status === "accepted") {
    return (
      <p className="text-sm text-muted-foreground">
        Prueba aceptada. Sin acciones aquí — gestiona el contrato.
      </p>
    );
  }

  // ---------- Panel de orden de desinstalación pendiente ----------
  function uninstallPanel() {
    if (!pendingUninstall) return null;
    if (pendingUninstall.status === "completed") return null; // gestionado por el flujo de cierre
    return (
      <div className="rounded-2xl border-2 border-warning/40 bg-warning/10 p-3 text-xs space-y-2">
        <div className="flex items-center gap-2 font-bold text-warning-foreground">
          <PackageMinus className="h-4 w-4" /> Desinstalación{" "}
          {pendingUninstall.status === "scheduled" ? "agendada" : "pendiente"}
        </div>
        <div>
          Orden{" "}
          <strong className="font-mono">
            {pendingUninstall.reference_code ?? `#${pendingUninstall.id.slice(0, 8)}`}
          </strong>
          {pendingUninstall.scheduled_at && (
            <>
              {" "}
              · prevista{" "}
              {new Date(pendingUninstall.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
            </>
          )}
        </div>
        <Link
          href={`/instalaciones/${pendingUninstall.id}` as never}
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
        >
          Ver / asignar técnico →
        </Link>
        <p className="text-[11px] text-muted-foreground">
          Cuando el técnico complete la retirada, la prueba pasará a «retirada»
          automáticamente y el stock volverá al almacén destino.
        </p>
      </div>
    );
  }

  // ---------- draft / scheduled (aún sin instalar) ----------
  if (status === "draft" || status === "scheduled") {
    return (
      <div className="space-y-3">
        <a
          href={`/api/pdf/free-trial/${trialId}`}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-sm font-semibold hover:bg-muted"
        >
          <FileDown className="h-4 w-4" /> Vista previa albarán
        </a>
        <SignAndInstallButton
          trialId={trialId}
          defaultCustomerName={customerName}
          defaultCustomerTaxId={customerTaxId}
        />
        <p className="text-xs text-muted-foreground">
          El wizard pide cuándo, tipo (provisional/definitiva), datos del
          firmante y captura las dos firmas (cliente + comercial). Tras
          confirmar, la prueba queda firmada e instalada (o programada).
        </p>
      </div>
    );
  }

  // ---------- installed: aceptar, rechazar, agendar desinstalación ----------
  if (status === "installed") {
    return (
      <div className="space-y-4">
        {isProvisional && (
          <div className="rounded-xl border-2 border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
            <Wrench className="inline h-3.5 w-3.5 -mt-0.5 mr-1" />
            <strong>Instalación provisional.</strong> Al aceptar, recuerda
            crear una orden de <strong>reubicación</strong> desde la ficha
            del cliente para hacer la instalación definitiva.
          </div>
        )}
        {uninstallPanel()}
        <a
          href={`/api/pdf/free-trial/${trialId}`}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-sm font-semibold hover:bg-muted"
        >
          <FileDown className="h-4 w-4" /> Albarán de entrega firmado
        </a>
        <Button
          onClick={accept}
          disabled={pending}
          variant="success"
          size="lg"
          className="w-full gap-2"
        >
          <Check className="h-5 w-5" />
          {pending ? "Procesando…" : "Aceptar — generar contrato"}
        </Button>
        <p className="text-xs text-muted-foreground">
          <FileSignature className="inline h-3.5 w-3.5 -mt-0.5" /> Crea un
          contrato en <strong>borrador</strong> y, si la prueba estaba a un
          lead, lo convierte en cliente. La instalación ya hecha se enlaza al
          nuevo contrato.
        </p>

        <div className="border-t pt-4 space-y-3">
          {!pendingUninstall && (
            <ScheduleUninstallButton
              trialId={trialId}
              warehouses={warehouses}
              installers={installers}
              reason="manual"
            />
          )}
          <div className="space-y-1.5">
            <Label>Motivo rechazo</Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              placeholder="¿Por qué no quiere?"
            />
            <Button
              variant="outline"
              onClick={reject}
              disabled={pending}
              className="w-full"
            >
              <X className="h-4 w-4" /> Marcar rechazada
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Al rechazar, agenda también la desinstalación para retirar el
              equipo.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------- rejected / expired: agendar desinstalación o ver pendiente ----------
  if (status === "rejected" || status === "expired") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-3 text-xs">
          {status === "expired"
            ? "La prueba ha caducado sin aceptarse."
            : "El cliente ha rechazado la prueba."}{" "}
          Para retirar el equipo debes agendar una desinstalación.
        </div>
        {uninstallPanel()}
        {!pendingUninstall && (
          <ScheduleUninstallButton
            trialId={trialId}
            warehouses={warehouses}
            installers={installers}
            reason={status === "expired" ? "expired" : "rejected"}
          />
        )}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">Sin acciones disponibles.</p>
  );
}
