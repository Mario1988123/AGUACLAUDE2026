"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { retryAeatSubmissionAction } from "./retry-actions";

export function RetryFailedButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const r = await retryAeatSubmissionAction(submissionId);
      if (r.ok) {
        notify.success("Reintento programado", "Se procesará en breve.");
        router.refresh();
      } else {
        notify.error("No se pudo reintentar", r.error);
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={retry}
      disabled={pending}
      className="gap-1"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Procesando…" : "Reintentar"}
    </Button>
  );
}
