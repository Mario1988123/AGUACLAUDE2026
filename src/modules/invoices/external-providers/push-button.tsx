"use client";

import { useTransition } from "react";
import { Send, ExternalLink } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { pushInvoiceToExternalProviderAction } from "./push-actions";

interface Props {
  invoiceId: string;
  providerName: string;
  /** Si ya se envió alguna vez, mostramos también el enlace al recurso externo. */
  lastExternalUrl?: string | null;
}

/**
 * Botón "Enviar a [proveedor]" en la ficha de factura. Solo visible si la
 * empresa tiene proveedor configurado y conexión validada. Pinta también el
 * enlace al recurso en el panel del proveedor si ya se envió.
 */
export function PushToExternalButton({
  invoiceId,
  providerName,
  lastExternalUrl,
}: Props) {
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const r = await pushInvoiceToExternalProviderAction(invoiceId);
      if (!r.ok) {
        notify.error("No se pudo enviar", r.error);
        return;
      }
      notify.success(
        `Enviada a ${providerName}`,
        r.aeat_csv
          ? `CSV AEAT: ${r.aeat_csv}`
          : r.external_id
            ? `ID externo: ${r.external_id}`
            : undefined,
      );
      // Sin reload aquí (el revalidatePath del servidor refresca la ficha).
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="default" onClick={send} disabled={pending}>
        <Send className="h-4 w-4" />
        {pending ? "Enviando…" : `Enviar a ${providerName}`}
      </Button>
      {lastExternalUrl && (
        <a
          href={lastExternalUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Abrir en {providerName}
        </a>
      )}
    </div>
  );
}
