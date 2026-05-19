"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Copy, Send } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { sendContractForRemoteSignAction } from "./remote-sign-actions";

interface Props {
  contractId: string;
  defaultEmail?: string | null;
  defaultName?: string | null;
}

export function SendRemoteSignButton({
  contractId,
  defaultEmail,
  defaultName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [name, setName] = useState(defaultName ?? "");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  function send() {
    if (!email.trim()) {
      notify.warning("Email obligatorio");
      return;
    }
    startTransition(async () => {
      const r = await sendContractForRemoteSignAction({
        contract_id: contractId,
        signer_email: email.trim(),
        signer_name: name.trim() || null,
      });
      if (!r.ok) {
        notify.error("No se pudo enviar", r.error);
        return;
      }
      notify.success("Email enviado al cliente");
      setResultUrl(r.sign_url);
      router.refresh();
    });
  }

  function copy() {
    if (!resultUrl) return;
    navigator.clipboard.writeText(resultUrl);
    notify.success("URL copiada");
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Mail className="h-4 w-4" /> Enviar para firmar por email
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold">
              Enviar contrato a firmar por email
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Se enviará un email al cliente con un enlace único para firmar
              online (sin tener que crearse cuenta). El enlace caduca a los
              14 días.
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Email del cliente</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@ejemplo.com"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nombre (opcional)</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Juan Pérez"
                />
              </div>

              {resultUrl && (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <div className="font-bold text-emerald-900">
                    ✓ Email enviado
                  </div>
                  <p className="mt-1 text-xs text-emerald-900">
                    Si el cliente no lo recibe, puedes copiar el enlace y
                    pasárselo manualmente:
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px]">
                      {resultUrl}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={copy}
                      className="gap-1"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t pt-3">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {resultUrl ? "Cerrar" : "Cancelar"}
              </Button>
              {!resultUrl && (
                <Button onClick={send} disabled={pending} variant="success" className="gap-2">
                  <Send className="h-3 w-3" />
                  {pending ? "Enviando…" : "Enviar email"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
