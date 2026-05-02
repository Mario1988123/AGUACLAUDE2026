"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createCompanyAction } from "./actions";

/**
 * Cliente form para crear empresa. Captura errores y los muestra como
 * toast en vez de propagar a 500 sin mensaje legible.
 */
export function NewCompanyForm() {
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createCompanyAction(fd);
        // El server action redirige al final, no llegaríamos aquí salvo error
      } catch (err) {
        // NEXT_REDIRECT no es error real
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("No se pudo crear", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border bg-card p-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Datos generales
        </legend>
        <div className="space-y-2">
          <Label htmlFor="name">Nombre comercial *</Label>
          <Input id="name" name="name" required placeholder="OSMOFILTER S.L." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">Slug interno *</Label>
          <Input
            id="slug"
            name="slug"
            required
            placeholder="osmofilter"
            title="Solo minúsculas, números y guiones"
          />
          <p className="text-xs text-muted-foreground">
            Identificador único de la empresa. Solo minúsculas, números y guiones (ej: <code>osmofilter</code>).
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Estado</Label>
          <select
            id="status"
            name="status"
            defaultValue="trial"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          >
            <option value="trial">Prueba</option>
            <option value="active">Activa</option>
            <option value="suspended">Suspendida</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="primary_color">Color principal</Label>
          <Input id="primary_color" name="primary_color" type="color" defaultValue="#2563eb" />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="col-span-full text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Límites y facturación
        </legend>
        <div className="space-y-2">
          <Label htmlFor="max_users">Usuarios máx.</Label>
          <Input id="max_users" name="max_users" type="number" min={1} defaultValue={5} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_storage_mb">Almacenamiento (MB)</Label>
          <Input
            id="max_storage_mb"
            name="max_storage_mb"
            type="number"
            min={64}
            defaultValue={1024}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="monthly_cost_cents">Coste mensual (céntimos)</Label>
          <Input
            id="monthly_cost_cents"
            name="monthly_cost_cents"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
        <div className="space-y-2 sm:col-span-3">
          <Label htmlFor="billing_email">Email de facturación</Label>
          <Input
            id="billing_email"
            name="billing_email"
            type="email"
            placeholder="facturacion@empresa.com"
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Datos fiscales (opcional, completables más tarde)
        </legend>
        <div className="space-y-2">
          <Label htmlFor="fiscal_legal_name">Razón social</Label>
          <Input id="fiscal_legal_name" name="fiscal_legal_name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fiscal_tax_id">CIF</Label>
          <Input id="fiscal_tax_id" name="fiscal_tax_id" placeholder="B12345678" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="fiscal_address">Domicilio fiscal</Label>
          <Input id="fiscal_address" name="fiscal_address" />
        </div>
      </fieldset>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href="/superadmin">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear empresa"}
        </Button>
      </div>
    </form>
  );
}
