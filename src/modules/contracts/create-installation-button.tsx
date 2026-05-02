"use client";

import { useState, useTransition } from "react";
import { Wrench, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { createInstallationFromContract } from "@/modules/installations/actions";

interface Props {
  contractId: string;
  installers: { user_id: string; full_name: string }[];
  warehouses?: { id: string; name: string }[];
  hasInstallation: boolean;
}

export function CreateInstallationButton({
  contractId,
  installers,
  warehouses = [],
  hasInstallation,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    scheduled_at: "",
    installer_user_id: "",
    source_warehouse_id: "",
  });

  if (hasInstallation) {
    return (
      <p className="text-sm text-muted-foreground">
        ✓ Instalación ya generada para este contrato.
      </p>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createInstallationFromContract({
          contract_id: contractId,
          scheduled_at: form.scheduled_at || undefined,
          installer_user_id: form.installer_user_id || undefined,
          source_warehouse_id: form.source_warehouse_id || undefined,
        });
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="default" className="w-full">
        <Wrench className="h-4 w-4" /> Generar instalación
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="when">Programar para</Label>
            <Input
              id="when"
              type="datetime-local"
              value={form.scheduled_at}
              onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="installer">Instalador</Label>
            <select
              id="installer"
              value={form.installer_user_id}
              onChange={(e) => setForm({ ...form, installer_user_id: e.target.value })}
              className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
            >
              <option value="">Sin asignar (programar después)</option>
              {installers.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </div>
          {warehouses.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="warehouse">Furgoneta de origen</Label>
              <select
                id="warehouse"
                value={form.source_warehouse_id}
                onChange={(e) => setForm({ ...form, source_warehouse_id: e.target.value })}
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                <option value="">Asignar después</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              <Plus className="h-4 w-4" /> {pending ? "Creando..." : "Crear instalación"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
