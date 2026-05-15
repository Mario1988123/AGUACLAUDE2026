"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  approvePunchRequestAction,
  rejectPunchRequestAction,
} from "./punch-requests-actions";

export function ApprovePunchRequestButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [notes, setNotes] = useState("");

  function approve() {
    startTransition(async () => {
      try {
        await approvePunchRequestAction(requestId);
        notify.success("Solicitud aprobada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function reject() {
    startTransition(async () => {
      try {
        await rejectPunchRequestAction(requestId, notes.trim() || undefined);
        notify.success("Solicitud rechazada");
        setRejectOpen(false);
        setNotes("");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="success"
        onClick={approve}
        disabled={pending}
      >
        Aprobar
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => setRejectOpen(true)}
        disabled={pending}
      >
        Rechazar
      </Button>
      {rejectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setRejectOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3 p-4">
              <h2 className="text-base font-bold">Rechazar solicitud</h2>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Motivo (opcional)"
                className="w-full rounded-xl border border-input bg-background p-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRejectOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={reject}
                disabled={pending}
              >
                Rechazar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
