"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Sparkles, Wrench, FileText, Loader2 } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { notify } from "@/shared/hooks/use-toast";
import {
  generateMonthlyMaintenanceInvoicesAction,
  type MaintenanceContractRow,
} from "./actions";

const TIER_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  lite: Wrench,
  medium: Sparkles,
  premium: Crown,
};

const TIER_VARIANT: Record<string, "default" | "secondary" | "warning"> = {
  lite: "secondary",
  medium: "default",
  premium: "warning",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  cancelled: "Cancelado",
  expired: "Caducado",
  draft: "Borrador",
};

function fmtEur(c: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function MaintenanceContractsTable({
  contracts,
}: {
  contracts: MaintenanceContractRow[];
}) {
  if (contracts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Sin contratos de mantenimiento todavía. Se generan desde la ficha del
        cliente o al completar una instalación.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Ref.</th>
            <th className="px-3 py-2 text-left">Cliente</th>
            <th className="px-3 py-2 text-left">Plan</th>
            <th className="px-3 py-2 text-right">Cuota mes</th>
            <th className="px-3 py-2 text-left">Estado</th>
            <th className="px-3 py-2 text-left">Inicio</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {contracts.map((c) => {
            const Icon = TIER_ICON[c.tier_snapshot] ?? Wrench;
            return (
              <tr key={c.id} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">
                  {c.reference_code ?? "—"}
                </td>
                <td className="px-3 py-2">{c.customer_name}</td>
                <td className="px-3 py-2">
                  <Badge variant={TIER_VARIANT[c.tier_snapshot] ?? "default"}>
                    <Icon className="h-3 w-3" /> {c.tier_snapshot.toUpperCase()}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtEur(c.monthly_cents_snapshot)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {STATUS_LABEL[c.status] ?? c.status}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(c.starts_on).toLocaleDateString("es-ES")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MaintenanceRemesaButton() {
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();
  const router = useRouter();

  function run() {
    startTransition(async () => {
      const ok = await ask({
        title: "Lanzar remesa mensual",
        message:
          "Se generará una factura del mes en curso por cada contrato de mantenimiento activo. Si la factura del mes ya existe, se omite.",
        confirmText: "Generar facturas",
        variant: "success",
      });
      if (!ok) return;
      try {
        const r = await generateMonthlyMaintenanceInvoicesAction();
        notify.success(
          `${r.created} facturas creadas`,
          r.skipped > 0 ? `${r.skipped} omitidas (ya existían)` : undefined,
        );
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Button size="sm" onClick={run} disabled={pending} variant="success">
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <FileText className="h-3 w-3" />
      )}
      Generar remesa mensual
    </Button>
  );
}
