"use client";

// Disponibilidad del cliente en la ficha de la prueba: se ve siempre y se
// puede cambiar mientras la prueba no esté instalada (borrador o programada).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { DisponibilidadEditor } from "./disponibilidad-editor";
import {
  resumenDisponibilidad,
  validarDisponibilidad,
  type Disponibilidad,
} from "./disponibilidad";
import { guardarDisponibilidadPruebaSafeAction } from "./actions";

export function DisponibilidadFicha({
  trialId,
  inicial,
  editable,
}: {
  trialId: string;
  inicial: Disponibilidad | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState<Disponibilidad | null>(inicial);
  const [pending, startTransition] = useTransition();
  const lineas = resumenDisponibilidad(inicial);

  function guardar() {
    const error = validarDisponibilidad(valor);
    if (error) {
      notify.warning(error);
      return;
    }
    startTransition(async () => {
      const r = await guardarDisponibilidadPruebaSafeAction(trialId, valor);
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Disponibilidad guardada");
      setEditando(false);
      router.refresh();
    });
  }

  if (editando) {
    return (
      <div className="space-y-3 rounded-xl border p-3">
        <strong>Disponibilidad del cliente</strong>
        <DisponibilidadEditor inicial={inicial} onChange={setValor} />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setValor(inicial);
              setEditando(false);
            }}
          >
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={guardar} disabled={pending}>
            <Save className="h-4 w-4" /> {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <strong>Disponibilidad del cliente:</strong>
        {lineas.length === 0 && <span className="text-muted-foreground">sin indicar</span>}
        {editable && (
          <button
            type="button"
            onClick={() => {
              setValor(inicial);
              setEditando(true);
            }}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {lineas.length > 0 ? "Cambiar" : "Indicar"}
          </button>
        )}
      </div>
      {lineas.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {lineas.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
