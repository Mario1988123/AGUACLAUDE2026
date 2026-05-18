"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Pause,
  Play,
  CalendarPlus,
  Home,
  Ban,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import {
  pauseRentalAction,
  resumeRentalAction,
  extendRentalAction,
} from "./rental-lifecycle-actions";
import { cancelContractAction } from "./actions";
import { FinalizeRentalDialog } from "./finalize-rental-modal";

type DialogKind = null | "pause" | "extend" | "cancel" | "finalize";

interface Props {
  contractId: string;
  isPaused: boolean;
  depositTotalCents: number;
  canCancel: boolean;
}

export function RentalActionsMenu({
  contractId,
  isPaused,
  depositTotalCents,
  canCancel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openMenu, setOpenMenu] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);

  function close() {
    setDialog(null);
    setOpenMenu(false);
  }

  function resume() {
    setOpenMenu(false);
    startTransition(async () => {
      const r = await resumeRentalAction(contractId);
      if (!r.ok) {
        notify.error("No se pudo reanudar", r.error);
        return;
      }
      notify.success("Alquiler reanudado");
      router.refresh();
    });
  }

  return (
    <div className="relative inline-block">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpenMenu((v) => !v)}
        disabled={pending}
        className="gap-1"
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {openMenu && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpenMenu(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full z-30 mt-1 min-w-[200px] rounded-xl border border-border bg-card p-1 shadow-lg">
            {isPaused ? (
              <MenuItem icon={<Play className="h-4 w-4" />} onClick={resume}>
                Reanudar alquiler
              </MenuItem>
            ) : (
              <MenuItem
                icon={<Pause className="h-4 w-4" />}
                onClick={() => setDialog("pause")}
              >
                Pausar alquiler
              </MenuItem>
            )}
            <MenuItem
              icon={<CalendarPlus className="h-4 w-4" />}
              onClick={() => setDialog("extend")}
            >
              Prorrogar
            </MenuItem>
            <MenuItem
              icon={<Home className="h-4 w-4" />}
              onClick={() => setDialog("finalize")}
            >
              Finalizar contrato
            </MenuItem>
            {canCancel && (
              <MenuItem
                icon={<Ban className="h-4 w-4 text-destructive" />}
                onClick={() => setDialog("cancel")}
                destructive
              >
                Cancelar contrato
              </MenuItem>
            )}
          </div>
        </>
      )}

      {dialog === "pause" && (
        <PauseDialog
          contractId={contractId}
          onClose={close}
          onDone={() => {
            close();
            router.refresh();
          }}
        />
      )}
      {dialog === "extend" && (
        <ExtendDialog
          contractId={contractId}
          onClose={close}
          onDone={() => {
            close();
            router.refresh();
          }}
        />
      )}
      {dialog === "cancel" && (
        <CancelDialog
          contractId={contractId}
          onClose={close}
          onDone={() => {
            close();
            router.refresh();
          }}
        />
      )}
      {dialog === "finalize" && (
        <FinalizeRentalDialog
          contractId={contractId}
          depositTotalCents={depositTotalCents}
          onClose={() => {
            close();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-left transition ${
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-muted"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function PauseDialog({
  contractId,
  onClose,
  onDone,
}: {
  contractId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  function save() {
    if (!reason.trim()) {
      notify.warning("Indica el motivo de la pausa");
      return;
    }
    startTransition(async () => {
      const r = await pauseRentalAction({ contract_id: contractId, reason });
      if (!r.ok) {
        notify.error("No se pudo pausar", r.error);
        return;
      }
      notify.success("Alquiler pausado");
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pausar alquiler</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Mientras esté pausado no se generarán cuotas mensuales. Si la
            pausa supera 30 días se programará automáticamente un
            mantenimiento preventivo (el equipo sigue instalado).
          </p>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Cliente de viaje, parón temporal, etc."
            />
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Pausando…" : "Pausar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExtendDialog({
  contractId,
  onClose,
  onDone,
}: {
  contractId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [months, setMonths] = useState("12");
  const [reason, setReason] = useState("");

  function save() {
    const n = Number(months);
    if (!Number.isFinite(n) || n < 1) {
      notify.warning("Indica meses (≥ 1)");
      return;
    }
    if (!reason.trim()) {
      notify.warning("Indica el motivo de la prórroga");
      return;
    }
    startTransition(async () => {
      const r = await extendRentalAction({
        contract_id: contractId,
        extra_months: n,
        reason,
      });
      if (!r.ok) {
        notify.error("No se pudo prorrogar", r.error);
        return;
      }
      notify.success(`Contrato prorrogado ${n} meses`);
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Prorrogar alquiler</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Meses adicionales</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
              <div className="flex gap-1">
                {[6, 12, 24].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMonths(String(m))}
                    className="rounded-md border bg-card px-2 py-0.5 text-[11px] font-bold hover:bg-muted"
                  >
                    +{m}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Renovación acordada con cliente"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Incrementa la duración del contrato sin crear uno nuevo. La cuota
            mensual se mantiene. Las nuevas cuotas seguirán generándose
            automáticamente en el cron del día 1.
          </p>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Prorrogando…" : "Prorrogar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  contractId,
  onClose,
  onDone,
}: {
  contractId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  function save() {
    if (!reason.trim()) {
      notify.warning("Motivo obligatorio para cancelar");
      return;
    }
    startTransition(async () => {
      const r = await cancelContractAction(contractId, reason);
      if (!r.ok) {
        notify.error("No se pudo cancelar", r.error);
        return;
      }
      notify.success("Contrato cancelado");
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar contrato</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-destructive">
            ⚠ Cancela el contrato de forma definitiva. Si quieres cerrar con
            normalidad (devolución/retención de fianza) usa <strong>Finalizar
            contrato</strong> en su lugar.
          </p>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo claro y trazable"
            />
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Volver
            </Button>
            <Button variant="destructive" onClick={save} disabled={pending}>
              {pending ? "Cancelando…" : "Cancelar contrato"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

