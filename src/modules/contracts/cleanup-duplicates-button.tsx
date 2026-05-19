"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { cleanupDuplicateContractPaymentsAction } from "./actions";

export function CleanupDuplicatePaymentsButton({
  contractId,
}: {
  contractId: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  async function run() {
    const ok = await ask({
      title: "Limpiar pagos duplicados",
      message:
        "Buscaremos pagos duplicados (mismo concepto y mismo importe en estado «pendiente») y dejaremos sólo uno por grupo. Los pagos ya cobrados o validados NO se tocan.",
      confirmText: "Limpiar",
      variant: "warning",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await cleanupDuplicateContractPaymentsAction(contractId);
      if (!r.ok) {
        notify.error("No se pudo limpiar", r.error);
        return;
      }
      if (r.removed === 0) {
        notify.info("Sin duplicados", "No se han encontrado pagos duplicados pendientes.");
      } else {
        notify.success(
          `${r.removed} duplicado${r.removed === 1 ? "" : "s"} eliminado${r.removed === 1 ? "" : "s"}`,
        );
      }
      router.refresh();
    });
  }

  return (
    <Button onClick={run} disabled={pending} size="sm" variant="outline" className="gap-1.5">
      <Sparkles className="h-3.5 w-3.5" />
      {pending ? "Limpiando…" : "Limpiar duplicados"}
    </Button>
  );
}
