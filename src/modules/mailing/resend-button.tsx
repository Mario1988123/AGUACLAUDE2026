"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { resendEmailAction } from "./dashboard-actions";

export function ResendButton({ emailId }: { emailId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  async function go() {
    const ok = await ask({
      message: "¿Reenviar este email tal cual? Se enviará de nuevo al mismo destinatario y quedará registrado como envío independiente.",
      confirmText: "Reenviar",
      variant: "default",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await resendEmailAction(emailId);
      if (!r.ok) {
        notify.error("No se pudo reenviar", r.error ?? "Error desconocido");
        return;
      }
      notify.success("Email reenviado");
      if (r.new_send_id) router.push(`/mailing/${r.new_send_id}` as never);
    });
  }

  return (
    <Button onClick={go} disabled={pending} variant="outline">
      <RotateCw className="h-4 w-4" /> {pending ? "Reenviando..." : "Reenviar"}
    </Button>
  );
}
