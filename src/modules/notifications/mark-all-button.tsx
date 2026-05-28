"use client";

import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { markAllAsReadSafeAction } from "./actions";

interface Props {
  /** Si se indica, solo marca las de esa categoría (no mezcla pestañas). */
  category?: "alert" | "event";
  label?: string;
}

export function MarkAllReadButton({ category, label }: Props = {}) {
  const [pending, startTransition] = useTransition();
  function handle() {
    startTransition(async () => {
      const r = await markAllAsReadSafeAction(category);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(
        category === "alert"
          ? "Alertas marcadas como leídas"
          : category === "event"
            ? "Eventos marcados como leídos"
            : "Todas marcadas como leídas",
      );
    });
  }
  return (
    <Button variant="outline" onClick={handle} disabled={pending}>
      {label ??
        (category === "alert"
          ? "Marcar alertas como leídas"
          : category === "event"
            ? "Marcar eventos como leídos"
            : "Marcar todas como leídas")}
    </Button>
  );
}
