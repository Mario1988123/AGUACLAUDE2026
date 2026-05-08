"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Download, XCircle, Trash2, Pencil } from "lucide-react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { deleteProposalAction, rejectProposalFromListAction } from "./actions";

/**
 * Acciones inline en el listado de propuestas: ver, PDF, rechazar, eliminar.
 */
export function ProposalRowActions({
  id,
  status,
  hasContract,
}: {
  id: string;
  status: string;
  hasContract: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openModal, setOpenModal] = useState<"reject" | "delete" | null>(null);
  const [reason, setReason] = useState("");

  // Estados terminales: ya no se puede rechazar/eliminar/editar
  const isTerminal = ["rejected", "expired", "superseded", "accepted"].includes(status);
  const canReject = !isTerminal;
  const canDelete = !hasContract && status !== "accepted";
  // Editable mientras no esté aceptada/rechazada/expirada/superseded
  const canEdit = !isTerminal;

  function confirmReject() {
    startTransition(async () => {
      const r = await rejectProposalFromListAction(id, reason.trim() || undefined);
      if (!r.ok) {
        notify.error("No se pudo rechazar", r.error);
        return;
      }
      notify.success("Propuesta rechazada");
      setOpenModal(null);
      setReason("");
      router.refresh();
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      const r = await deleteProposalAction(id);
      if (!r.ok) {
        notify.error("No se pudo eliminar", r.error);
        return;
      }
      notify.success("Propuesta eliminada");
      setOpenModal(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Link
          href={`/propuestas/${id}` as never}
          title="Ver propuesta"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
        >
          <Eye className="h-4 w-4" />
        </Link>
        <a
          href={`/api/pdf/proposal/${id}`}
          target="_blank"
          rel="noopener"
          title="Descargar PDF"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
        >
          <Download className="h-4 w-4" />
        </a>
        {canEdit && (
          <Link
            href={`/propuestas/${id}/editar` as never}
            title="Editar propuesta"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
          >
            <Pencil className="h-4 w-4" />
          </Link>
        )}
        {canReject && (
          <button
            type="button"
            onClick={() => setOpenModal("reject")}
            disabled={pending}
            title="Rechazar"
            className="flex h-8 w-8 items-center justify-center rounded-md text-amber-600 hover:bg-amber-100"
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => setOpenModal("delete")}
            disabled={pending}
            title="Eliminar"
            className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {openModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpenModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="space-y-3 p-5">
              <h2 className="text-base font-bold">
                {openModal === "reject" ? "Rechazar propuesta" : "Eliminar propuesta"}
              </h2>
              {openModal === "reject" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Indica el motivo del rechazo (opcional).
                  </p>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="No interesa al cliente, precio fuera de presupuesto…"
                    className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Esta acción elimina la propuesta del listado. No se podrá deshacer desde la UI.
                  Si ya hay un contrato generado, no se permite eliminar.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => {
                  setOpenModal(null);
                  setReason("");
                }}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={openModal === "reject" ? confirmReject : confirmDelete}
                disabled={pending}
              >
                {openModal === "reject" ? "Rechazar" : "Eliminar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
