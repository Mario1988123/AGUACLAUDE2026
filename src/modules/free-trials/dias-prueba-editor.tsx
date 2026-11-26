"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { cambiarDiasPruebaSafeAction } from "./actions";

/** Días de prueba con «Cambiar» en la ficha (Mario 2026-11-26). */
export function DiasPruebaEditor({
  trialId,
  dias,
  editable,
}: {
  trialId: string;
  dias: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(dias));
  const [pending, startTransition] = useTransition();

  function guardar() {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1) {
      notify.warning("Indica un número de días");
      return;
    }
    startTransition(async () => {
      const r = await cambiarDiasPruebaSafeAction(trialId, n);
      if (!r.ok) {
        notify.error("No se pudo cambiar", r.error);
        return;
      }
      notify.success("Días de prueba cambiados");
      setEditando(false);
      router.refresh();
    });
  }

  if (!editando) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>
          <strong>Días de prueba:</strong> {dias}
        </span>
        {editable && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="min-h-8 rounded-full border border-border px-3 text-xs font-semibold hover:bg-muted"
          >
            Cambiar
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <strong>Días de prueba:</strong>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={120}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="h-9 w-24"
      />
      <Button size="sm" onClick={guardar} disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditando(false)} disabled={pending}>
        Cancelar
      </Button>
    </div>
  );
}
