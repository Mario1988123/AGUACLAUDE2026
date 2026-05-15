"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  markLegalNoticeReviewedAction,
  dismissLegalNoticeAction,
} from "./legal-notices-actions";

export function LegalNoticeButtons({ noticeId }: { noticeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState("");

  function mark() {
    startTransition(async () => {
      const r = await markLegalNoticeReviewedAction(noticeId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Marcado como revisado");
      router.refresh();
    });
  }

  function dismiss() {
    startTransition(async () => {
      const r = await dismissLegalNoticeAction(
        noticeId,
        reason.trim() || undefined,
      );
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Descartado");
      setDismissOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="success" onClick={mark} disabled={pending}>
        Revisado
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setDismissOpen(true)}
        disabled={pending}
      >
        Descartar
      </Button>
      {dismissOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setDismissOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h3 className="text-base font-bold">Descartar aviso</h3>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo (opcional)"
                className="w-full rounded-xl border border-input bg-background p-2 text-sm"
              />
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDismissOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={dismiss}
                disabled={pending}
              >
                Descartar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
