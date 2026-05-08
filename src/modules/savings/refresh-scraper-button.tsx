"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { refreshScraperPricesAction } from "./actions";

export function RefreshScraperButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const r = await refreshScraperPricesAction();
      if (!r.ok) {
        notify.error("No se pudo refrescar", r.error);
        return;
      }
      const { ok, failed, total } = r.stats;
      if (total === 0) {
        notify.info("Ninguna marca configurada con scraper", "Configura el origen 'Scraper Mercadona/Carrefour' en alguna marca primero.");
      } else if (failed === 0) {
        notify.success(
          `${ok} marca${ok === 1 ? "" : "s"} actualizada${ok === 1 ? "" : "s"}`,
        );
      } else {
        notify.warning(
          `${ok} ok · ${failed} con error`,
          "Revisa el histórico de scrapes y los términos de búsqueda.",
        );
      }
      router.refresh();
    });
  }

  return (
    <Button onClick={refresh} disabled={pending} variant="outline" className="gap-2">
      <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Refrescando…" : "Actualizar precios ahora"}
    </Button>
  );
}
