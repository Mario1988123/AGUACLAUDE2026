"use client";

import { useState, useTransition } from "react";
import { MailCheck, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { sendInstallationConfirmationAction } from "./confirmation-send-actions";

export function InstallationConfirmSendButton({
  installationId,
  alreadySent,
}: {
  installationId: string;
  alreadySent?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  function send() {
    setResult(null);
    start(async () => {
      const r = await sendInstallationConfirmationAction(installationId);
      setResult(
        r.ok
          ? { ok: true, message: "Confirmación enviada al cliente" }
          : { ok: false, message: r.error },
      );
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={send}
        disabled={pending}
        className="gap-2"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MailCheck className="h-4 w-4" />
        )}
        {alreadySent ? "Reenviar confirmación" : "Enviar confirmación al cliente"}
      </Button>
      {result && (
        <span
          className={`inline-flex items-center gap-1 text-xs ${
            result.ok ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {result.ok ? (
            <CheckCircle className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {result.message}
        </span>
      )}
    </div>
  );
}
