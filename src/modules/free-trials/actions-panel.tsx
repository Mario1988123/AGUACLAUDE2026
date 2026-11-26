"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  X,
  FileSignature,
  FileDown,
  Wrench,
  PackageMinus,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { rejectFreeTrialSafeAction } from "./actions";
import { AcceptFreeTrialButton } from "./accept-modal";
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
  puedeInstalar = false,
  expiresAt = null,
}: {
  trialId: string;
  status: string;
  isProvisional?: boolean;
  customerName: string;
  customerTaxId: string | null;
  warehouses: WarehouseOption[];
  installers: InstallerOption[];
  pendingUninstall: PendingUninstall | null;
  /** Instalador asignado, admin o director técnico (permisos.ts). */
  puedeInstalar?: boolean;
  expiresAt?: string | null;
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
        "Venta perdida",
        "El lead pasa a perdido. Ahora agenda la retirada del equipo.",
      );
      router.refresh();
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
        {puedeInstalar ? (
          <>
            <SignAndInstallButton
              trialId={trialId}
              defaultCustomerName={customerName}
              defaultCustomerTaxId={customerTaxId}
            />
            <p className="text-xs text-muted-foreground">
              Se pulsa en casa del cliente al instalar: pide si es provisional o
              definitiva, los datos del firmante y las dos firmas. Al terminar
              empieza a contar la prueba y se avisa al comercial.
            </p>
          </>
        ) : (
          <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            {status === "draft"
              ? "Pendiente de que el admin la agende con el cliente."
              : "Agendada. La instala el instalador asignado el día de la cita."}
          </p>
        )}
      </div>
    );
  }

  // ---------- installed / expired: decidir ----------
  // «expired» = terminó la prueba sin decidir: sigue pudiendo quedársela o
  // retirarse (Mario 2026-11-26). Nunca se queda sin salida.
  if (status === "installed" || status === "expired") {
    const terminada =
      status === "expired" || (!!expiresAt && new Date(expiresAt).getTime() <= Date.now());
    return (
      <div className="space-y-4">
        {terminada && (
          <div className="rounded-xl border-2 border-destructive/40 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            La prueba ha terminado. Llama al cliente y decide: se la queda o se retira.
          </div>
        )}
        {isProvisional && (
          <div className="rounded-xl border-2 border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
            <Wrench className="inline h-3.5 w-3.5 -mt-0.5 mr-1" />
            <strong>Instalación provisional.</strong> Si se la queda, elige
            «Se queda, pero hay que fijarlo» y se crea la orden de reinstalación.
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
        <AcceptFreeTrialButton trialId={trialId} isProvisional={isProvisional} />
        <p className="text-xs text-muted-foreground">
          <FileSignature className="inline h-3.5 w-3.5 -mt-0.5" /> Eliges{" "}
          <strong>alquiler o compra</strong>, el equipo (el de la prueba u otro) y qué
          se hace con el instalado. Se crea el contrato en <strong>borrador</strong>{" "}
          y, si era un lead, pasa a cliente.
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
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base md:text-sm"
              placeholder="¿Por qué no se la queda?"
            />
            <Button
              variant="outline"
              onClick={reject}
              disabled={pending}
              className="w-full"
            >
              <X className="h-4 w-4" /> No se la queda (venta perdida)
            </Button>
            <p className="text-[11px] text-muted-foreground">
              El lead pasa a perdido y después agendas la retirada del equipo.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------- rejected: agendar desinstalación o ver pendiente ----------
  if (status === "rejected") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-3 text-xs">
          No se la queda (venta perdida). Para retirar el equipo agenda la
          desinstalación.
        </div>
        {uninstallPanel()}
        {!pendingUninstall && (
          <ScheduleUninstallButton
            trialId={trialId}
            warehouses={warehouses}
            installers={installers}
            reason="rejected"
          />
        )}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">Sin acciones disponibles.</p>
  );
}
