"use client";

import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, AlertCircle, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  getInstallationProductAids,
  type InstallationProductAid,
} from "./product-aids-actions";

interface Props {
  installationId: string;
  /** Si true, muestra los avisos como modal automático cuando se monta
   *  el componente (al iniciar parte). Si false, solo muestra botón
   *  "Manual" siempre disponible. */
  showOnMount: boolean;
}

/**
 * Panel de ayudas a la instalación que ve el instalador en el wizard:
 *  · Botón "Manual del equipo" (visible siempre, abre PDF en nueva pestaña).
 *  · Modal automático con notas/sugerencias del producto al iniciar parte.
 *    (showOnMount=true). El instalador lo cierra cuando lo lee.
 */
export function InstallationAidsPanel({ installationId, showOnMount }: Props) {
  const [aids, setAids] = useState<InstallationProductAid[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    getInstallationProductAids(installationId)
      .then((r) => {
        setAids(r);
        if (showOnMount && r.some((a) => a.notes && a.notes.trim().length > 0)) {
          setModalOpen(true);
        }
      })
      .finally(() => setLoaded(true));
  }, [installationId, showOnMount]);

  if (!loaded || aids.length === 0) return null;

  const withManual = aids.filter((a) => a.manual_url);
  const withNotes = aids.filter((a) => a.notes && a.notes.trim().length > 0);

  return (
    <>
      {/* Botones de manuales (siempre visibles) */}
      {withManual.length > 0 && (
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-2 text-sm font-bold flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Manuales de instalación
          </div>
          <div className="flex flex-wrap gap-2">
            {withManual.map((a) => (
              <a
                key={a.product_id}
                href={a.manual_url!}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-bold text-primary hover:bg-primary/10"
              >
                {a.product_name}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
          {withNotes.length > 0 && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="mt-2 text-xs font-semibold text-amber-700 underline hover:text-amber-900"
            >
              ⚠ Ver {withNotes.length} aviso{withNotes.length === 1 ? "" : "s"} del admin
            </button>
          )}
        </div>
      )}

      {/* Modal de notas */}
      {modalOpen && withNotes.length > 0 && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-2"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-amber-300 bg-amber-100 px-4 py-3">
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <AlertCircle className="h-5 w-5" />
                Sugerencias del admin antes de instalar
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md p-1 hover:bg-amber-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {withNotes.map((a) => (
                <div
                  key={a.product_id}
                  className="rounded-xl bg-white p-3 text-sm"
                >
                  <div className="font-bold text-amber-900">
                    {a.product_name}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-foreground">
                    {a.notes}
                  </pre>
                </div>
              ))}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-amber-300 bg-amber-100 p-3">
              <Button
                variant="success"
                onClick={() => setModalOpen(false)}
                className="gap-2"
              >
                He leído los avisos
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
