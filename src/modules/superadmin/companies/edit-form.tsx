"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateCompanySafeAction } from "./actions";

interface CompanyEditFormProps {
  company: {
    id: string;
    name?: string | null;
    slug?: string | null;
    max_users?: number | null;
    max_storage_mb?: number | null;
    monthly_cost_cents?: number | null;
    billing_email?: string | null;
    primary_color?: string | null;
    fiscal_legal_name?: string | null;
    fiscal_tax_id?: string | null;
    fiscal_address?: string | null;
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

/**
 * Datos, plan y límites de la empresa. El estado (pausar, baja, reactivar) no
 * se cambia aquí: va en la «Zona peligrosa», que además lo deja auditado.
 */
export function CompanyEditForm({ company }: CompanyEditFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: company.name ?? "",
    slug: company.slug ?? "",
    max_users: company.max_users ?? 5,
    max_storage_mb: company.max_storage_mb ?? 1024,
    billing_email: company.billing_email ?? "",
    primary_color: company.primary_color ?? "#2563eb",
    fiscal_legal_name: company.fiscal_legal_name ?? "",
    fiscal_tax_id: company.fiscal_tax_id ?? "",
    fiscal_address: company.fiscal_address ?? "",
  });
  // Estado local del campo de coste mostrado en EUROS al usuario.
  const [costInputEur, setCostInputEur] = useState<string>(
    centsToEur(company.monthly_cost_cents),
  );

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      notify.error("Falta el nombre", "El nombre necesita al menos 2 caracteres.");
      return;
    }
    if (!Number.isInteger(form.max_users) || form.max_users < 1) {
      notify.error("Usuarios máx. no válido", "Tiene que ser 1 o más.");
      return;
    }
    if (!Number.isInteger(form.max_storage_mb) || form.max_storage_mb < 64) {
      notify.error("Almacenamiento no válido", "El mínimo son 64 MB.");
      return;
    }
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
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Identificación
        </legend>
        <div className="space-y-2">
          <Label htmlFor="emp-nombre">Nombre</Label>
          <Input id="emp-nombre" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="emp-slug">Slug</Label>
            <Input
              id="emp-slug"
              value={form.slug}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => set("slug", e.target.value.toLowerCase())}
            />
            <p className="text-xs text-muted-foreground">Minúsculas, números y guiones.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="emp-color">Color</Label>
            <Input
              id="emp-color"
              type="color"
              className="h-11 w-full p-1 sm:w-20"
              value={form.primary_color}
              onChange={(e) => set("primary_color", e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Datos fiscales y contacto
        </legend>
        <div className="space-y-2">
          <Label htmlFor="emp-razon">Razón social</Label>
          <Input
            id="emp-razon"
            value={form.fiscal_legal_name}
            onChange={(e) => set("fiscal_legal_name", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="emp-cif">CIF / NIF</Label>
            <Input
              id="emp-cif"
              value={form.fiscal_tax_id}
              autoCapitalize="characters"
              onChange={(e) => set("fiscal_tax_id", e.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emp-email">Email de facturación</Label>
            <Input
              id="emp-email"
              type="email"
              inputMode="email"
              value={form.billing_email}
              onChange={(e) => set("billing_email", e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="emp-dir">Dirección fiscal</Label>
          <Input
            id="emp-dir"
            value={form.fiscal_address}
            onChange={(e) => set("fiscal_address", e.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Plan y límites
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="emp-usuarios">Usuarios máx.</Label>
            <Input
              id="emp-usuarios"
              type="number"
              inputMode="numeric"
              min={1}
              value={form.max_users}
              onChange={(e) => set("max_users", Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emp-mb">Almacenamiento (MB)</Label>
            <Input
              id="emp-mb"
              type="number"
              inputMode="numeric"
              min={64}
              value={form.max_storage_mb}
              onChange={(e) => set("max_storage_mb", Number(e.target.value))}
            />
          </div>
          <div className="col-span-2 space-y-2 sm:col-span-1">
            <Label htmlFor="emp-coste">Coste al mes (€)</Label>
            <Input
              id="emp-coste"
              type="text"
              inputMode="decimal"
              placeholder="199,50"
              value={costInputEur}
              onChange={(e) => setCostInputEur(e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="h-11 w-full sm:w-auto">
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
