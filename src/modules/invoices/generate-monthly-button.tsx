"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { generateMonthlyRecurringInvoicesAction } from "./actions";

export function GenerateMonthlyButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function go() {
    if (
      !confirm(
        "Generar facturas del mes para todos los contratos de alquiler/renting activos? Idempotente: no duplica si ya existen.",
      )
    )
      return;
    startTransition(async () => {
      try {
        const r = await generateMonthlyRecurringInvoicesAction();
        notify.success(`${r.created} factura(s) generada(s)`);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <Button variant="outline" onClick={go} disabled={pending} className="gap-2">
      <CalendarClock className="h-4 w-4" />
      {pending ? "Generando..." : "Generar facturas del mes"}
    </Button>
  );
}
