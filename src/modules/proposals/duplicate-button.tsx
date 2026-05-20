"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { duplicateProposalAction } from "./actions";

export function DuplicateProposalButton({
  proposalId,
}: {
  proposalId: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  async function run() {
    const ok = await ask({
      title: "Duplicar propuesta",
      message:
        "Se creará una copia en estado «borrador» con los mismos productos. Podrás editar y enviarla por separado.",
      confirmText: "Duplicar",
      variant: "default",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await duplicateProposalAction(proposalId);
      if (!r.ok) {
        notify.error("No se pudo duplicar", r.error);
        return;
      }
      notify.success("Propuesta duplicada");
      router.push(`/propuestas/${r.new_proposal_id}`);
    });
  }

  return (
    <Button
      onClick={run}
      disabled={pending}
      size="sm"
      variant="outline"
      className="gap-1.5"
    >
      <Copy className="h-3.5 w-3.5" />
      {pending ? "Duplicando…" : "Duplicar"}
    </Button>
  );
}
