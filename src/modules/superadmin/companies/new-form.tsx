"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createCompanyAction } from "./actions";

/** Convierte cualquier nombre en un slug válido [a-z0-9-]+, máx 50.
 *  Quita acentos, baja a minúsculas, sustituye no-alfanuméricos por
 *  guiones y colapsa los repetidos. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 50);
}

/**
 * Cliente form para crear empresa. Captura errores y los muestra como
 * toast en vez de propagar a 500 sin mensaje legible.
 */
export function NewCompanyForm() {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Si el usuario edita el slug a mano, paramos el auto-derive.
  const [slugTouched, setSlugTouched] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // El input pide euros (ej. "199,50"). Convertimos a céntimos para BD.
    const eurosRaw = String(fd.get("monthly_cost_euros") ?? "").trim();
    if (eurosRaw) {
      const n = Number(eurosRaw.replace(",", "."));
      if (!Number.isNaN(n) && n >= 0) {
        fd.set("monthly_cost_cents", String(Math.round(n * 100)));
      } else {
        fd.set("monthly_cost_cents", "0");
      }
    } else {
      fd.set("monthly_cost_cents", "0");
    }
    fd.delete("monthly_cost_euros");
    startTransition(async () => {
      try {
        const res = await createCompanyAction(fd);
        // En éxito redirige (NEXT_REDIRECT). Si devuelve {ok:false} es un aviso legible.
        if (res && res.ok === false) {
          notify.error("No se pudo crear", res.error);
          return;
        }
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
          <Input
            id="name"
            name="name"
            required
            placeholder="OSMOFILTER S.L."
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              setName(v);
              if (!slugTouched) setSlug(slugify(v));
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">Slug interno *</Label>
          <Input
            id="slug"
            name="slug"
            required
            placeholder="osmofilter"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              // Sanitizamos en vivo: lo que escribas se normaliza a
              // [a-z0-9-]+ ANTES de mostrarse, así nunca puede mandar
              // un valor inválido al server.
              setSlug(slugify(e.target.value));
            }}
            title="Solo minúsculas, números y guiones"
          />
          <p className="text-xs text-muted-foreground">
            Auto-generado desde el nombre. Editable: solo se permiten
            minúsculas, números y guiones (ej: <code>osmofilter</code>).
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
          <Label htmlFor="monthly_cost_euros">Coste mensual (€)</Label>
          <Input
            id="monthly_cost_euros"
            name="monthly_cost_euros"
            type="text"
            inputMode="decimal"
            placeholder="199,50"
            defaultValue=""
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
