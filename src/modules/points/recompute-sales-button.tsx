"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { recomputeMissingSalesPointsSafeAction } from "./config-actions";

/**
 * Admin-only: re-otorga puntos de venta a comerciales que firmaron y
 * cuyo contrato se instaló pero quedaron sin puntos por el bug del
 * assigned_user_id NULL (anterior al 2026-05-22). Idempotente: si los
 * puntos ya están otorgados, no duplica.
 */
export function RecomputeSalesPointsButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  async function run() {
    const ok = await ask({
      title: "Recalcular puntos de venta pendientes",
      message:
        "Recorre todas las instalaciones completadas y otorga los puntos de venta al comercial cuando falten. Si el comercial ya tiene puntos por esa venta, no se duplica. ¿Continuar?",
      confirmText: "Recalcular",
      variant: "warning",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await recomputeMissingSalesPointsSafeAction();
      if (!r.ok) {
        notify.error("No se pudo recalcular", r.error);
        return;
      }
      if (r.awarded === 0) {
        notify.info(
          "Nada que recalcular",
          `${r.processed} instalaciones revisadas, todas ya tenían sus puntos.`,
        );
      } else {
        notify.success(
          `${r.awarded} venta${r.awarded === 1 ? "" : "s"} con puntos otorgados`,
          `${r.processed} revisadas · ${r.skipped} omitidas (ya tenían puntos o sin comercial)`,
        );
      }
      if (r.errors.length > 0) {
        notify.warning(
          `${r.errors.length} con errores`,
          r.errors.slice(0, 3).join("\n"),
        );
      }
      router.refresh();
    });
  }

  return (
    <Button variant="outline" onClick={run} disabled={pending} className="gap-2">
      <RotateCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Recalculando..." : "Recalcular puntos de venta pendientes"}
    </Button>
  );
}
