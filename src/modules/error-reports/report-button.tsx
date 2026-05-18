"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Bug, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { reportErrorAction } from "./actions";

/**
 * Botón flotante "Reportar fallo" visible para cualquier usuario
 * autenticado. Captura ruta actual, user_agent y resolución para
 * adjuntarlo al ticket.
 */
export function ReportErrorButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState("");

  function send() {
    if (message.trim().length < 5) {
      notify.warning("Escribe al menos 5 caracteres describiendo el problema");
      return;
    }
    const tech =
      typeof window !== "undefined"
        ? {
            user_agent: navigator.userAgent,
            language: navigator.language,
            screen: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            timestamp: new Date().toISOString(),
          }
        : {};
    startTransition(async () => {
      const r = await reportErrorAction({
        route: pathname,
        severity,
        message: message.trim(),
        steps_to_reproduce: steps.trim() || null,
        technical_payload: tech,
      });
      if (!r.ok) {
        notify.error("No se pudo enviar", r.error);
        return;
      }
      notify.success(
        "Reporte enviado",
        "Lo revisaremos lo antes posible. Gracias.",
      );
      setOpen(false);
      setMessage("");
      setSteps("");
      setSeverity("medium");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Reportar un fallo"
        aria-label="Reportar un fallo"
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-white shadow-lg hover:bg-slate-900"
      >
        <Bug className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-slate-700" />
                <h2 className="text-base font-bold">Reportar un fallo</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-xs text-muted-foreground">
                Algo no funciona como esperabas? Cuéntanoslo y lo
                revisaremos. Tu ruta actual y datos técnicos se enviarán
                automáticamente.
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Gravedad</Label>
                <select
                  value={severity}
                  onChange={(e) =>
                    setSeverity(
                      e.target.value as "low" | "medium" | "high" | "critical",
                    )
                  }
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="low">Baja — molestia menor</option>
                  <option value="medium">Media — funciona mal pero hay workaround</option>
                  <option value="high">Alta — no puedo hacer mi trabajo</option>
                  <option value="critical">Crítica — afecta a clientes / dinero</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">¿Qué ha pasado? *</Label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder="He intentado X y me ha aparecido Y…"
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pasos para reproducir (opcional)</Label>
                <textarea
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  rows={3}
                  placeholder="1. Voy a /facturas\n2. Pulso «Nueva factura»\n3. Se queda en blanco"
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm font-mono text-xs"
                />
              </div>
              <div className="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <strong>Ruta:</strong> {pathname}
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={send} disabled={pending}>
                {pending ? "Enviando…" : "Enviar reporte"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
