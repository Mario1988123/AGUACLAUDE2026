"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { generateLegacyContractsAction } from "./legacy-contracts-actions";

/**
 * Botón admin (migración): genera los contratos heredados a partir de la
 * modalidad de cada equipo. Procesa por lotes hasta terminar. Idempotente.
 */
export function GenerateLegacyContractsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState(0);

  function run() {
    setCreated(0);
    startTransition(async () => {
      let total = 0;
      for (let i = 0; i < 1000; i++) {
        const r = await generateLegacyContractsAction({ limit: 50 });
        if (!r.ok) {
          notify.error("No se pudo generar", r.error);
          setOpen(false);
          return;
        }
        total += r.result.created;
        setCreated(total);
        if (r.result.remaining <= 0) break;
        if (r.result.created === 0) break; // sin progreso (todo errores) → parar
      }
      notify.success(
        total > 0 ? `${total} contratos heredados creados` : "No había contratos nuevos que generar",
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCreated(0);
          setOpen(true);
        }}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
      >
        <FileSignature className="h-4 w-4" /> Contratos heredados
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">Generar contratos heredados</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Crea un contrato por cada equipo que tenga modalidad puesta
              (venta/alquiler/renting) y aún no tenga contrato:
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>• <strong>Venta</strong>: contrato contado, sin cobros.</li>
              <li>• <strong>Alquiler</strong>: activo, cobra <strong>desde el próximo mes</strong> (sin atrasados).</li>
              <li>• <strong>Renting</strong>: registro; la cuota la cobra la financiera.</li>
            </ul>
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Se puede repetir sin duplicar (idempotente). Rellena la modalidad
                de los equipos antes de generar.
              </span>
            </div>
            {pending && created > 0 && (
              <p className="mt-3 text-sm font-semibold">Creados: {created}…</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={run} disabled={pending}>
                {pending ? "Generando…" : "Generar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
