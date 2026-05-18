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
  History,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
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
import { PaymentHistoryDialog } from "./payment-history-dialog";

type DialogKind = null | "pause" | "extend" | "cancel" | "finalize" | "history";

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
  const [, startTransition] = useTransition();
  const [dialog, setDialog] = useState<DialogKind>(null);

  function close() {
    setDialog(null);
  }

  function resume() {
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuItem onSelect={() => setDialog("history")}>
            <History className="h-4 w-4" />
            Ver historial de cobros
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isPaused ? (
            <DropdownMenuItem onSelect={resume}>
              <Play className="h-4 w-4" />
              Reanudar alquiler
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setDialog("pause")}>
              <Pause className="h-4 w-4" />
              Pausar alquiler
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setDialog("extend")}>
            <CalendarPlus className="h-4 w-4" />
            Prorrogar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("finalize")}>
            <Home className="h-4 w-4" />
            Finalizar contrato
          </DropdownMenuItem>
          {canCancel && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDialog("cancel")}
                variant="destructive"
              >
                <Ban className="h-4 w-4" />
                Cancelar contrato
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "history" && (
        <PaymentHistoryDialog contractId={contractId} onClose={close} />
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
    </>
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
