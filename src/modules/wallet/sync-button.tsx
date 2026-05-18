"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { syncContractPaymentsAction } from "./sync-action";

export function SyncPaymentsButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function run() {
    startTransition(async () => {
      const r = await syncContractPaymentsAction();
      if (!r.ok) {
        notify.error("No se pudo sincronizar", r.error);
        return;
      }
      const msg = `${r.wallet_links_repaired} vínculos · ${r.payments_propagated} cobros propagados`;
      if (r.errors.length > 0) {
        notify.warning("Sync con avisos", `${msg} · ${r.errors.length} errores`);
      } else if (r.wallet_links_repaired === 0 && r.payments_propagated === 0) {
        notify.success("Ya estaba todo sincronizado");
      } else {
        notify.success("Sincronizado", msg);
      }
      router.refresh();
    });
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={pending}
      className="gap-2"
      title="Repara vínculos wallet ↔ contract_payment"
    >
      <RotateCw className={`h-3 w-3 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Sincronizando…" : "Sincronizar pagos"}
    </Button>
  );
}
