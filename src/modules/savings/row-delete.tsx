"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import { deleteSavingsProposalAction } from "./actions";

export function SavingsRowDelete({
  id,
  reference,
}: {
  id: string;
  reference: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function del() {
    if (!confirm(`¿Eliminar propuesta ${reference ?? id.slice(0, 8)}?`)) return;
    startTransition(async () => {
      const r = await deleteSavingsProposalAction(id);
      if (!r.ok) {
        notify.error("No se pudo eliminar", r.error);
        return;
      }
      notify.success("Propuesta eliminada");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={del}
      disabled={pending}
      title="Eliminar"
      className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
