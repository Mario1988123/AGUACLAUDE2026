"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import {
  bulkReassignCustomersAction,
  bulkDeleteCustomersAction,
} from "./bulk-actions";

export function CustomerBulkToolbar({
  selectedIds,
  team,
  onClear,
  canDelete = false,
}: {
  selectedIds: string[];
  team: { user_id: string; full_name: string }[];
  onClear: () => void;
  /** Solo admin: muestra "Borrar seleccionados". */
  canDelete?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [word, setWord] = useState("");
  const [delDone, setDelDone] = useState(0);
  const router = useRouter();

  if (selectedIds.length === 0) return null;

  function reassign() {
    startTransition(async () => {
      const r = await bulkReassignCustomersAction({
        customer_ids: selectedIds,
        user_id: target || null,
      });
      if (!r.ok) {
        notify.error("No se pudo reasignar", r.error);
        return;
      }
      notify.success(`Reasignados ${r.count} clientes`);
      onClear();
      router.refresh();
    });
  }

  function bulkDelete() {
    if (word.trim().toLowerCase() !== "borrar") {
      notify.warning("Escribe «borrar» para confirmar");
      return;
    }
    startTransition(async () => {
      let deleted = 0;
      let skipped = 0;
      setDelDone(0);
      const CH = 100;
      for (let i = 0; i < selectedIds.length; i += CH) {
        const chunk = selectedIds.slice(i, i + CH);
        const r = await bulkDeleteCustomersAction({
          customer_ids: chunk,
          confirm_word: word,
        });
        if (!r.ok) {
          notify.error("Error", r.error);
          break;
        }
        deleted += r.deleted;
        skipped += r.skipped;
        setDelDone(deleted + skipped);
      }
      notify.success(
        `${deleted} clientes borrados${skipped ? ` · ${skipped} saltados (tienen contrato/instalación)` : ""}`,
      );
      setDelOpen(false);
      setWord("");
      onClear();
      router.refresh();
    });
  }

  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-primary bg-primary/10 p-3 shadow-md">
      <Users className="h-4 w-4 text-primary" />
      <span className="text-sm font-bold text-primary">{selectedIds.length} seleccionados</span>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        disabled={pending}
        className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
      >
        <option value="">— Desasignar —</option>
        {team.map((t) => (
          <option key={t.user_id} value={t.user_id}>
            {t.full_name}
          </option>
        ))}
      </select>
      <Button onClick={reassign} disabled={pending} size="sm">
        Reasignar
      </Button>
      {canDelete && (
        <Button
          onClick={() => {
            setWord("");
            setDelOpen(true);
          }}
          disabled={pending}
          size="sm"
          variant="destructive"
        >
          <Trash2 className="h-3.5 w-3.5" /> Borrar
        </Button>
      )}
      <Button onClick={onClear} variant="ghost" size="sm">
        Cancelar
      </Button>

      {delOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setDelOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">Borrar {selectedIds.length} clientes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Borrado físico de los clientes seleccionados (con sus direcciones,
              banco y equipos). Las propuestas se borran también. Los que tengan
              <strong> contrato o instalación</strong> se saltan (no se borran).
              Pensado para limpiar una importación y rehacerla.
            </p>
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>No se puede deshacer. Escribe <strong>borrar</strong> para confirmar.</span>
            </div>
            <Input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="borrar"
              autoComplete="off"
              className="mt-3"
            />
            {pending && delDone > 0 && (
              <p className="mt-2 text-sm font-semibold">
                Procesados {delDone}/{selectedIds.length}…
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDelOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={bulkDelete}
                disabled={pending || word.trim().toLowerCase() !== "borrar"}
              >
                {pending ? "Borrando…" : `Borrar ${selectedIds.length}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
