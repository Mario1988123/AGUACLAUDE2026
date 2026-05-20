"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { bulkActivateContractsAction } from "./bulk-validate-actions";

interface Props {
  selectedIds: string[];
  onClear: () => void;
}

export function ContractBulkToolbar({ selectedIds, onClear }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  if (selectedIds.length === 0) return null;

  async function activate() {
    const ok = await ask({
      title: "Activar contratos en lote",
      message: `¿Activar ${selectedIds.length} contratos firmados? Solo se promueven los que están en estado «Firmado».`,
      confirmText: "Activar",
      variant: "success",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await bulkActivateContractsAction(selectedIds);
      if (!r.ok) {
        notify.error("No se pudo activar", r.error);
        return;
      }
      notify.success(
        `${r.activated} activados`,
        r.skipped > 0 ? `${r.skipped} omitidos (no estaban en estado firmado)` : undefined,
      );
      onClear();
      router.refresh();
    });
  }

  function exportSel() {
    const url = `/api/export/contracts?ids=${selectedIds.join(",")}`;
    window.open(url, "_blank", "noopener");
  }

  return (
    <div className="sticky top-2 z-40 flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-primary bg-primary/5 p-3 shadow-md">
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
          {selectedIds.length} seleccionados
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted-foreground hover:underline"
        >
          Quitar selección
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="success"
          onClick={activate}
          disabled={pending}
          className="gap-1.5"
        >
          <CheckCircle2 className="h-4 w-4" />
          Activar firmados
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={exportSel}
          disabled={pending}
          className="gap-1.5"
        >
          <Download className="h-4 w-4" />
          Exportar CSV selección
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onClear}
          disabled={pending}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
