"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpCircle, Check, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  applyCatalogUpdateSafeAction,
  dismissCatalogUpdateSafeAction,
  type ProductCatalogStatus,
} from "./catalog-update-actions";

/**
 * Aviso "actualización disponible" del catálogo maestro en la ficha del
 * producto de la empresa. Solo se muestra si hay una versión nueva.
 */
export function CatalogUpdateBanner({
  productId,
  status,
}: {
  productId: string;
  status: ProductCatalogStatus;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  if (!status.hasUpdate) return null;

  function apply() {
    startTransition(async () => {
      const ok = await confirm({
        title: "Aplicar actualización del fabricante",
        message:
          "Se actualizarán los datos, atributos y documentos nuevos con los del catálogo. NO se tocará tu precio, tu stock ni tus fotos. ¿Continuar?",
        confirmText: "Aplicar",
      });
      if (!ok) return;
      const r = await applyCatalogUpdateSafeAction(productId);
      if (!r.ok) notify.error("No se pudo aplicar", r.error);
      else {
        notify.success("Producto actualizado con los cambios del fabricante");
        router.refresh();
      }
    });
  }

  function dismiss() {
    startTransition(async () => {
      const r = await dismissCatalogUpdateSafeAction(productId);
      if (!r.ok) notify.error("Error", r.error);
      else {
        notify.success("Aviso descartado", "Te quedas con tu versión actual.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
      <ArrowUpCircle className="h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-amber-900">⚠ Actualización disponible del fabricante</div>
        <div className="text-xs text-amber-800">
          {status.masterName ? `"${status.masterName}". ` : ""}
          El catálogo tiene una versión más nueva (v{status.fromVersion} → v{status.toVersion}).
          Aplica los cambios o quédate con tu versión.
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="success" size="sm" onClick={apply} disabled={pending}>
          <Check className="h-4 w-4" /> Aplicar
        </Button>
        <Button variant="outline" size="sm" onClick={dismiss} disabled={pending}>
          <X className="h-4 w-4" /> Descartar
        </Button>
      </div>
    </div>
  );
}
