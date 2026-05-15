"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import {
  approvePurchaseSuggestionAction,
  dismissPurchaseSuggestionAction,
} from "./purchase-suggestions-actions";

export function SuggestionActions({
  id,
  suggestedQty,
}: {
  id: string;
  suggestedQty: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qty, setQty] = useState(String(suggestedQty));

  function approve() {
    const n = Number(qty);
    if (!n || n <= 0) {
      notify.warning("Cantidad inválida");
      return;
    }
    startTransition(async () => {
      const r = await approvePurchaseSuggestionAction(id, n);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Aprobada");
      router.refresh();
    });
  }

  function dismiss() {
    startTransition(async () => {
      const r = await dismissPurchaseSuggestionAction(id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Descartada");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="h-9 w-20 text-sm"
      />
      <Button
        size="sm"
        variant="success"
        onClick={approve}
        disabled={pending}
        className="gap-1"
      >
        <Check className="h-3.5 w-3.5" /> Aprobar
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={dismiss}
        disabled={pending}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
