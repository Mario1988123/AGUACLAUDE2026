"use client";

import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { rejectWalletEntryAction, validateWalletEntryAction } from "./actions";

interface Props {
  id: string;
  canValidate: boolean;
}

export function ValidateWalletButtons({ id, canValidate }: Props) {
  const [pending, startTransition] = useTransition();

  if (!canValidate) return null;

  function validate() {
    startTransition(async () => {
      try {
        await validateWalletEntryAction(id);
        notify.success("Cobro validado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function reject() {
    const reason = prompt("Motivo del rechazo:");
    if (!reason) return;
    startTransition(async () => {
      try {
        await rejectWalletEntryAction(id, reason);
        notify.success("Cobro rechazado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="success" onClick={validate} disabled={pending}>
        Validar
      </Button>
      <Button size="sm" variant="outline" onClick={reject} disabled={pending}>
        Rechazar
      </Button>
    </div>
  );
}
