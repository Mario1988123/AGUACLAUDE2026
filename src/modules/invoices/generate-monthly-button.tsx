"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { generateMonthlyRecurringInvoicesAction } from "./actions";

export function GenerateMonthlyButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();
  async function go() {
    const ok = await ask({
      message:
        "Generar facturas del mes para todos los contratos de alquiler/renting activos? Idempotente: no duplica si ya existen.",
      confirmText: "Generar",
      variant: "success",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const r = await generateMonthlyRecurringInvoicesAction();
        if (r.created === 0) {
          notify.info(
            "Nada que remesar",
            "No hay contratos pendientes de facturar este mes (o las facturas ya existen).",
          );
        } else {
          notify.success(
            `${r.created} factura${r.created === 1 ? "" : "s"} generada${r.created === 1 ? "" : "s"}`,
          );
        }
        router.refresh();
      } catch (err) {
        notify.error(
          "No se pudo generar la remesa",
          err instanceof Error ? err.message : String(err),
        );
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
