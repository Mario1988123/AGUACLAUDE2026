"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { approveAbsenceAction } from "./absences-actions";

export function ApproveAbsenceButtons({ absenceId }: { absenceId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function decide(approve: boolean) {
    startTransition(async () => {
      try {
        await approveAbsenceAction(absenceId, approve);
        notify.success(approve ? "Aprobada" : "Rechazada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="success" onClick={() => decide(true)} disabled={pending} className="gap-1">
        <Check className="h-4 w-4" /> Aprobar
      </Button>
      <Button size="sm" variant="destructive" onClick={() => decide(false)} disabled={pending} className="gap-1">
        <X className="h-4 w-4" /> Rechazar
      </Button>
    </div>
  );
}
