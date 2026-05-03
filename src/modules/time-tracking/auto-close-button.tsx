"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { autoCloseStalePunchesAction } from "./actions";

export function AutoCloseButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function go() {
    startTransition(async () => {
      try {
        const r = await autoCloseStalePunchesAction();
        notify.success(`${r.closed} fichaje(s) cerrados automáticamente`);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <Button variant="outline" onClick={go} disabled={pending} className="gap-2">
      <Power className="h-4 w-4" /> Cerrar olvidos
    </Button>
  );
}
