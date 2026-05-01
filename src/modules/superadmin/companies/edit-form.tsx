"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateCompanyAction } from "./actions";
import type { CompanyStatus } from "./types";

interface CompanyEditFormProps {
  company: {
    id: string;
    name: string;
    status: string;
    max_users: number;
    max_storage_mb: number;
    monthly_cost_cents: number;
    billing_email: string | null;
    primary_color: string | null;
  };
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
    name: company.name,
    status: company.status as CompanyStatus,
    max_users: company.max_users,
    max_storage_mb: company.max_storage_mb,
    monthly_cost_cents: company.monthly_cost_cents,
    billing_email: company.billing_email ?? "",
    primary_color: company.primary_color ?? "#2563eb",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateCompanyAction(company.id, form);
        notify.success("Empresa actualizada");
      } catch (err) {
        notify.error("No se pudo actualizar", err instanceof Error ? err.message : String(err));
      }
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
          <Label>Coste/mes (cts)</Label>
          <Input
            type="number"
            min={0}
            value={form.monthly_cost_cents}
            onChange={(e) => setForm({ ...form, monthly_cost_cents: Number(e.target.value) })}
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
