"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateCompanySafeAction } from "./actions";
import type { CompanyStatus } from "./types";

interface CompanyEditFormProps {
  company: {
    id: string;
    name?: string | null;
    status?: string | null;
    max_users?: number | null;
    max_storage_mb?: number | null;
    monthly_cost_cents?: number | null;
    billing_email?: string | null;
    primary_color?: string | null;
  };
}

/** Convierte céntimos a euros como string (ej. 19950 → "199,50"). */
function centsToEur(c: number | null | undefined): string {
  if (c == null) return "";
  return (c / 100).toFixed(2).replace(".", ",");
}

/** Convierte un input de euros ("199,50" o "199.50") a céntimos. */
function eurToCents(s: string): number | null {
  const trimmed = s.trim().replace(",", ".");
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function CompanyEditForm({ company }: CompanyEditFormProps) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<{
    name: string;
    status: CompanyStatus;
    max_users: number;
    max_storage_mb: number;
    monthly_cost_cents: number;
    billing_email: string;
    primary_color: string;
  }>({
    name: company.name ?? "",
    status: (company.status as CompanyStatus) || "trial",
    max_users: company.max_users ?? 5,
    max_storage_mb: company.max_storage_mb ?? 1024,
    monthly_cost_cents: company.monthly_cost_cents ?? 0,
    billing_email: company.billing_email ?? "",
    primary_color: company.primary_color ?? "#2563eb",
  });
  // Estado local del campo de coste mostrado en EUROS al usuario.
  const [costInputEur, setCostInputEur] = useState<string>(
    centsToEur(company.monthly_cost_cents),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Convertir euros tecleados a céntimos antes de enviar a la action.
    const cents = eurToCents(costInputEur);
    if (cents === null) {
      notify.error(
        "Coste no válido",
        "Usa números con coma o punto decimal (ej. 199,50).",
      );
      return;
    }
    const payload = { ...form, monthly_cost_cents: cents };
    startTransition(async () => {
      const r = await updateCompanySafeAction(company.id, payload);
      if (!r.ok) {
        notify.error("No se pudo actualizar", r.error);
        return;
      }
      notify.success("Empresa actualizada");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Nombre</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Estado</Label>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as CompanyStatus })}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          >
            <option value="trial">Prueba</option>
            <option value="active">Activa</option>
            <option value="suspended">Suspendida</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Color</Label>
          <Input
            type="color"
            value={form.primary_color}
            onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label>Usuarios máx.</Label>
          <Input
            type="number"
            min={1}
            value={form.max_users}
            onChange={(e) => setForm({ ...form, max_users: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>Storage MB</Label>
          <Input
            type="number"
            min={64}
            value={form.max_storage_mb}
            onChange={(e) => setForm({ ...form, max_storage_mb: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>Coste/mes (€)</Label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="199,50"
            value={costInputEur}
            onChange={(e) => setCostInputEur(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Email facturación</Label>
        <Input
          type="email"
          value={form.billing_email}
          onChange={(e) => setForm({ ...form, billing_email: e.target.value })}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
