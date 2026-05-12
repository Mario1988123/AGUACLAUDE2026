"use client";

import { useState, useTransition } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { backfillSalesRecordsAction } from "./backfill-sales-records";

/**
 * Botón para regenerar `sales_records` desde los contratos firmados.
 * Útil cuando el insert automático de `markContractSigned` se silenció
 * por algún error (enum, schema cache…) y el dashboard muestra 0 €
 * pese a tener contratos firmados.
 */
export function BackfillSalesRecordsButton() {
  const [pending, startTransition] = useTransition();
  const [last, setLast] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  function run() {
    if (
      !confirm(
        "¿Regenerar sales_records desde los contratos firmados?\n\nEsto borra los registros previos de cada contrato y los recalcula. Es seguro y se puede ejecutar varias veces.",
      )
    )
      return;
    startTransition(async () => {
      try {
        const r = await backfillSalesRecordsAction();
        const okMsg = `${r.records_inserted} registros creados (${r.contracts_processed} contratos procesados)`;
        if (r.errors.length > 0) {
          notify.warning(
            "Backfill con errores",
            `${okMsg}. Errores:\n${r.errors.slice(0, 3).join("\n")}`,
          );
          setLast({
            ok: false,
            msg: `${okMsg}. ${r.errors.length} errores: ${r.errors.join("; ")}`,
          });
        } else {
          notify.success("Listo", okMsg);
          setLast({ ok: true, msg: okMsg });
        }
        // Forzamos refresh del dashboard al volver
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        notify.error(
          "Error",
          err instanceof Error ? err.message : String(err),
        );
        setLast({
          ok: false,
          msg: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={run}
        disabled={pending}
        className="gap-2"
      >
        <RotateCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Recalculando..." : "Recalcular ventas del mes"}
      </Button>
      {last && (
        <p
          className={`text-xs ${last.ok ? "text-success" : "text-destructive"}`}
        >
          {last.msg}
        </p>
      )}
    </div>
  );
}
