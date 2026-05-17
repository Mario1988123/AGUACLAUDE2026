"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";

export function WalletInfoButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Cómo funcionan los estados"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex shrink-0 items-center justify-between border-b p-4">
              <h2 className="text-lg font-bold">Cómo funciona el wallet</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                <div className="mb-2 font-bold text-blue-900">
                  💳 Tarjeta · Transferencia · Bizum · SEPA
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-blue-900">
                  <li>
                    <span className="font-semibold">Sin cobrar</span> — cliente no ha pagado.
                  </li>
                  <li>
                    <span className="font-semibold">Cobrado · pdte. banco</span> — comercial tiene
                    justificante (datáfono, captura transferencia/bizum). Falta que el admin lo vea
                    llegar al banco.
                  </li>
                  <li>
                    <span className="font-semibold">Confirmado en banco</span> — admin lo ha visto
                    en el extracto. Estado final.
                  </li>
                </ol>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="mb-2 font-bold text-emerald-900">💶 Efectivo</div>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-emerald-900">
                  <li>
                    <span className="font-semibold">Sin cobrar</span> — cliente no ha pagado.
                  </li>
                  <li>
                    <span className="font-semibold">Cobrado · pdte. liquidar</span> — comercial cobró
                    el efectivo y lo tiene en mano. Falta entregárselo al admin.
                  </li>
                  <li>
                    <span className="font-semibold">Liquidado al admin</span> — admin recibió el
                    efectivo. Estado final (no pasa por banco).
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
