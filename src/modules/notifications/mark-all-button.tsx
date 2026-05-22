"use client";

import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { markAllAsReadSafeAction } from "./actions";

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  function handle() {
    startTransition(async () => {
      const r = await markAllAsReadSafeAction();
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Todas marcadas como leídas");
    });
  }
  return (
    <Button variant="outline" onClick={handle} disabled={pending}>
      Marcar todas como leídas
    </Button>
  );
}
