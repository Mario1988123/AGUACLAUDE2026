"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { resendEmailAction } from "./dashboard-actions";

/**
 * Botón "Reenviar" en la página de detalle de un email del módulo Mailing.
 * Sustituye al antiguo ResendButton (que estaba acoplado a Resend).
 */
export function ReenviarButton({ emailId }: { emailId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClick() {
    if (pending || done) return;
    startTransition(async () => {
      const r = await resendEmailAction(emailId);
      if (!r.ok) {
        notify.error("No se pudo reenviar", r.error);
        return;
      }
      notify.success("Reenviado");
      setDone(true);
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending || done}>
      <RefreshCw className={`mr-2 h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      {done ? "Reenviado" : "Reenviar"}
    </Button>
  );
}
