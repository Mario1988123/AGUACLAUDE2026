"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home, AlertTriangle } from "lucide-react";
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
import { finalizeRentalContractAction } from "./finalize-rental-actions";

function eur(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

interface Props {
  contractId: string;
  depositTotalCents: number;
}

type Mode = "return_full" | "retain_penalty" | "partial_return" | "none";

export function FinalizeRentalButton({ contractId, depositTotalCents }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full gap-2"
      >
        <Home className="h-4 w-4" /> Finalizar contrato alquiler
      </Button>
      {open && (
        <FinalizeDialog
          contractId={contractId}
          depositTotalCents={depositTotalCents}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FinalizeDialog({
  contractId,
  depositTotalCents,
  onClose,
}: {
  contractId: string;
  depositTotalCents: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(
    depositTotalCents > 0 ? "return_full" : "none",
  );
  const [partialEuros, setPartialEuros] = useState("");
  const [reason, setReason] = useState("");

  const partialCents = partialEuros
    ? Math.round(Number(partialEuros) * 100)
    : 0;
  const partialInvalid =
    mode === "partial_return" &&
    (partialCents <= 0 || partialCents > depositTotalCents);

  function save() {
    if (!reason.trim()) {
      notify.warning("Motivo obligatorio");
      return;
    }
    if (partialInvalid) {
      notify.warning("Importe parcial fuera de rango");
      return;
    }
    startTransition(async () => {
      const r = await finalizeRentalContractAction({
        contract_id: contractId,
        reason,
        deposit_action: mode,
        partial_return_cents: mode === "partial_return" ? partialCents : null,
      });
      if (!r.ok) {
        notify.error("No se pudo finalizar", r.error);
        return;
      }
      notify.success("Contrato finalizado");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finalizar contrato de alquiler</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Fianza cobrada</span>
              <span className="font-bold tabular-nums">
                {eur(depositTotalCents)}
              </span>
            </div>
            {depositTotalCents === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Este contrato no tiene fianza registrada; el cierre solo
                cambiará el estado a «completado».
              </p>
            )}
          </div>

          {depositTotalCents > 0 && (
            <div className="space-y-2">
              <Label>¿Qué hacemos con la fianza?</Label>
              <div className="grid gap-2">
                <ModeOption
                  active={mode === "return_full"}
                  onClick={() => setMode("return_full")}
                  title="Devolver íntegra"
                  desc={`Devuelve ${eur(depositTotalCents)} al cliente.`}
                />
                <ModeOption
                  active={mode === "retain_penalty"}
                  onClick={() => setMode("retain_penalty")}
                  title="Retener como penalización"
                  desc={`La empresa retiene ${eur(depositTotalCents)}. Para baja anticipada.`}
                  warning
                />
                <ModeOption
                  active={mode === "partial_return"}
                  onClick={() => setMode("partial_return")}
                  title="Devolución parcial"
                  desc="Devuelve parte y retén el resto como penalización."
                />
              </div>
              {mode === "partial_return" && (
                <div className="rounded-xl border bg-muted/20 p-3 space-y-1.5">
                  <Label className="text-xs">Importe a devolver (€)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={depositTotalCents / 100}
                    value={partialEuros}
                    onChange={(e) => setPartialEuros(e.target.value)}
                    placeholder={`Máx. ${(depositTotalCents / 100).toFixed(2)}`}
                  />
                  {partialEuros && !partialInvalid && (
                    <p className="text-[11px] text-muted-foreground">
                      Devuelve {eur(partialCents)} · Retiene{" "}
                      {eur(depositTotalCents - partialCents)}
                    </p>
                  )}
                  {partialInvalid && (
                    <p className="flex items-center gap-1 text-[11px] text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Debe ser entre 0,01
                      € y {(depositTotalCents / 100).toFixed(2)} €
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Motivo del cierre</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: Cliente solicita baja, fin natural del contrato…"
            />
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Procesando…" : "Finalizar contrato"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  desc,
  warning = false,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  warning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border-2 p-3 text-left transition ${
        active
          ? warning
            ? "border-amber-400 bg-amber-50"
            : "border-primary bg-primary/5"
          : "border-border bg-card hover:bg-muted/30"
      }`}
    >
      <div className="text-sm font-bold">{title}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </button>
  );
}
