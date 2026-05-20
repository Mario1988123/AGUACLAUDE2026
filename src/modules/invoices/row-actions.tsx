"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Trash2, FileX } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  markInvoicePaidSafeAction,
  deleteOrRectifyInvoiceSafeAction,
} from "./actions";

interface Props {
  invoiceId: string;
  status: string;
  pendingCents: number;
  isCreditNote: boolean;
  hasCreditNote: boolean;
}

export function InvoiceRowActions({
  invoiceId,
  status,
  pendingCents,
  isCreditNote,
  hasCreditNote,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();

  const canCollect =
    pendingCents > 0 &&
    status !== "draft" &&
    status !== "cancelled" &&
    status !== "void" &&
    status !== "paid" &&
    !isCreditNote;

  const canDelete =
    !isCreditNote &&
    !hasCreditNote &&
    status !== "cancelled" &&
    status !== "void";

  async function collect() {
    const ok = await ask({
      message: `¿Marcar como cobrada por el importe pendiente?`,
      confirmText: "Cobrar",
      variant: "success",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await markInvoicePaidSafeAction(invoiceId);
      if (!r.ok) {
        notify.error("No se pudo cobrar", r.error);
        return;
      }
      notify.success("Factura cobrada");
      router.refresh();
    });
  }

  async function del() {
    const ok = await ask({
      message:
        "Si esta factura es la ÚLTIMA de la numeración y está en borrador, se BORRA. Si no, se creará una rectificativa que la anule. ¿Continuar?",
      confirmText: "Borrar / Rectificar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteOrRectifyInvoiceSafeAction(invoiceId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      if (r.deleted) {
        notify.success("Factura borrada (era la última en borrador)");
      } else {
        notify.success("Rectificativa creada");
        if (r.credit_note_id)
          router.push(`/facturas/${r.credit_note_id}` as never);
      }
      router.refresh();
    });
  }

  return (
    <div className="inline-flex items-center gap-1">
      {canCollect && (
        <Button
          size="sm"
          variant="success"
          onClick={collect}
          disabled={pending}
          title="Marcar como cobrada"
        >
          <Coins className="h-3.5 w-3.5" /> Cobrar
        </Button>
      )}
      {canDelete && (
        <Button
          size="sm"
          variant="ghost"
          onClick={del}
          disabled={pending}
          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          title="Borrar o rectificar"
        >
          {status === "draft" ? (
            <Trash2 className="h-3.5 w-3.5" />
          ) : (
            <FileX className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}
