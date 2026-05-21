"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { autoCloseStalePunchesSafeAction } from "./actions";

export function AutoCloseButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function go() {
    startTransition(async () => {
      const r = await autoCloseStalePunchesSafeAction();
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(`${r.closed} fichaje(s) cerrados automáticamente`);
      router.refresh();
    });
  }
  return (
    <Button variant="outline" onClick={go} disabled={pending} className="gap-2">
      <Power className="h-4 w-4" /> Cerrar olvidos
    </Button>
  );
}
