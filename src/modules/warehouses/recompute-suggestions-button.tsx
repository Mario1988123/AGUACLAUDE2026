"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { recomputePurchaseSuggestionsAction } from "./purchase-suggestions-actions";

export function RecomputeSuggestionsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run() {
    startTransition(async () => {
      const r = await recomputePurchaseSuggestionsAction();
      if (!r.ok) {
        notify.error("Error", r.error ?? "");
        return;
      }
      notify.success(
        `Recalculado · ${r.created} sugerencias nuevas`,
      );
      router.refresh();
    });
  }
  return (
    <Button variant="outline" onClick={run} disabled={pending} className="gap-2">
      <RefreshCw className="h-4 w-4" /> {pending ? "Calculando..." : "Recalcular"}
    </Button>
  );
}
