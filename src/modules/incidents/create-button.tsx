"use client";

import { useState, useTransition } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { createIncidentSafeAction } from "./actions";
import { ORIGIN_LABEL, PRIORITY_LABEL } from "./constants";

interface Props {
  customerId?: string;
  installationId?: string;
  maintenanceJobId?: string;
}

export function CreateIncidentButton({ customerId, installationId, maintenanceJobId }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    title: "",
    description: "",
    origin: "other" as keyof typeof ORIGIN_LABEL,
    priority: "medium" as keyof typeof PRIORITY_LABEL,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createIncidentSafeAction({
        ...form,
        customer_id: customerId,
        installation_id: installationId,
        maintenance_job_id: maintenanceJobId,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Incidencia abierta");
      setOpen(false);
      setForm({ title: "", description: "", origin: "other", priority: "medium" });
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="destructive">
        <AlertTriangle className="h-4 w-4" /> Abrir incidencia
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Título *</Label>
            <Input
              id="title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Avería filtro, equipo no enciende..."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Origen</Label>
              <select
                value={form.origin}
                onChange={(e) =>
                  setForm({ ...form, origin: e.target.value as keyof typeof ORIGIN_LABEL })
                }
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                {Object.entries(ORIGIN_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <select
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as keyof typeof PRIORITY_LABEL })
                }
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Descripción</Label>
            <textarea
              id="description"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-xl border border-border bg-card p-3 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              <Plus className="h-4 w-4" /> {pending ? "Creando..." : "Crear incidencia"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
