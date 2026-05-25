"use client";

import { useState, useTransition } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { sendAllTemplatesTestAction } from "./test-send-actions";

export function TestSendButton({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  const [pending, startTransition] = useTransition();

  function send() {
    if (!email.trim()) {
      notify.warning("Indica un email");
      return;
    }
    startTransition(async () => {
      const r = await sendAllTemplatesTestAction(email.trim());
      if (!r.ok) {
        notify.error("No se pudieron enviar", r.error);
        return;
      }
      notify.success(
        `${r.sent} emails enviados`,
        r.failed > 0 ? `${r.failed} fallaron — revisa Resend.` : "Revisa tu bandeja.",
      );
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="success"
        onClick={() => setOpen(true)}
        className="gap-1"
      >
        <Send className="h-4 w-4" />
        Enviar prueba real
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold">Enviar todas las plantillas</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Envía las {12} plantillas del sistema renderizadas con datos de
              muestra al email indicado. Asunto prefijado con [TEST].
            </p>
            <div className="mt-4 space-y-2">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                disabled={pending}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={send} disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Enviar
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
