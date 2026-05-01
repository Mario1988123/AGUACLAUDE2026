"use client";

import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { markAllAsRead } from "./actions";

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  function handle() {
    startTransition(async () => {
      try {
        await markAllAsRead();
        notify.success("Todas marcadas como leídas");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <Button variant="outline" onClick={handle} disabled={pending}>
      Marcar todas como leídas
    </Button>
  );
}
