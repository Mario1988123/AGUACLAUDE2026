"use client";

import { useTransition } from "react";
import { Mail, Send } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  sendProposalByEmailAction,
  sendContractByEmailAction,
  sendInvoiceByEmailAction,
} from "./send-document-actions";

type DocKind = "proposal" | "contract" | "invoice";

const LABEL: Record<DocKind, string> = {
  proposal: "Enviar propuesta por email",
  contract: "Enviar contrato por email",
  invoice: "Enviar factura por email",
};

const SUCCESS_MSG: Record<DocKind, string> = {
  proposal: "Propuesta enviada al cliente",
  contract: "Contrato enviado al cliente",
  invoice: "Factura enviada al cliente",
};

export function SendByEmailButton({
  documentId,
  kind,
  variant = "outline",
  size = "default",
  short = false,
}: {
  documentId: string;
  kind: DocKind;
  variant?: "default" | "outline" | "ghost" | "success";
  size?: "default" | "sm" | "lg";
  /** Si true muestra solo icono + "Enviar". */
  short?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      let result: { ok: boolean; error?: string };
      if (kind === "proposal") {
        result = await sendProposalByEmailAction(documentId);
      } else if (kind === "contract") {
        result = await sendContractByEmailAction(documentId);
      } else {
        result = await sendInvoiceByEmailAction(documentId);
      }
      if (result.ok) {
        notify.success(SUCCESS_MSG[kind]);
      } else {
        notify.error("No se pudo enviar", result.error ?? "Error desconocido");
      }
    });
  }

  return (
    <Button onClick={send} disabled={pending} variant={variant} size={size}>
      {pending ? <Send className="h-4 w-4 animate-pulse" /> : <Mail className="h-4 w-4" />}
      {short ? (pending ? "Enviando…" : "Enviar") : pending ? "Enviando…" : LABEL[kind]}
    </Button>
  );
}
