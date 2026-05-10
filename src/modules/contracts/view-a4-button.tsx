"use client";

import { useState } from "react";
import { Eye, X, Download } from "lucide-react";
import { Button } from "@/shared/ui/button";

/**
 * Botón "Ver A4" que abre un modal a pantalla completa con el PDF del
 * contrato embebido. El PDF ya se genera en /api/pdf/contract/[id] y
 * contiene cláusulas, pagos, datos del cliente y huecos de firma.
 */
export function ViewA4Button({ contractId }: { contractId: string }) {
  const [open, setOpen] = useState(false);
  const pdfUrl = `/api/pdf/contract/${contractId}`;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Eye className="h-4 w-4" /> Ver contrato
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/80 p-2 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-3">
              <h2 className="text-base font-bold">Vista previa del contrato</h2>
              <div className="flex items-center gap-2">
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
                >
                  <Download className="h-3 w-3" /> Descargar PDF
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-2 hover:bg-muted"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe
              src={pdfUrl}
              title="Contrato A4"
              className="h-full w-full flex-1 border-0 bg-muted"
            />
          </div>
        </div>
      )}
    </>
  );
}
