"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  updateProposalsConfigAction,
  type ProposalsConfig,
} from "./actions";

export function ProposalsConfigForm({ initial }: { initial: ProposalsConfig }) {
  const [days, setDays] = useState(initial.default_validity_days);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateProposalsConfigAction({ default_validity_days: days });
        notify.success("Guardado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="vdays">Validez por defecto (días)</Label>
        <Input
          id="vdays"
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Cuando un comercial crea una propuesta sin marcar fecha de validez,
          se aplica este número de días desde la creación.
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
