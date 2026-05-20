"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { updateContractNotesSafeAction } from "./actions";

export function ContractNotesEditor({
  contractId,
  initial,
  canEdit,
}: {
  contractId: string;
  initial: string | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    startTransition(async () => {
      const r = await updateContractNotesSafeAction(contractId, value);
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Notas guardadas");
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        {initial ? (
          <p className="whitespace-pre-wrap text-sm">{initial}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Sin notas en este contrato.</p>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> {initial ? "Editar notas" : "Añadir notas"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
        placeholder="Notas internas del contrato..."
        className="w-full rounded-xl border border-input bg-background p-3 text-sm"
      />
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={pending}>
          <X className="h-4 w-4" /> Cancelar
        </Button>
        <Button onClick={save} disabled={pending} variant="success" size="sm">
          <Save className="h-4 w-4" /> {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
