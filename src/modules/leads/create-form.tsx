"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createLeadAction } from "./actions";
import { LEAD_ORIGIN, LEAD_POTENTIAL, ORIGIN_LABEL } from "./schemas";
import { provinceFromPostalCode } from "@/shared/lib/validations/spanish";

export function LeadCreateForm() {
  const [partyKind, setPartyKind] = useState<"individual" | "company">("individual");
  const [pending, startTransition] = useTransition();
  const [postal, setPostal] = useState("");
  const [province, setProvince] = useState("");

  function onPostalChange(v: string) {
    setPostal(v);
    if (v.length === 5 && !province) {
      const p = provinceFromPostalCode(v);
      if (p) setProvince(p);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createLeadAction(fd);
      } catch (err) {
        // redirect() lanza una excepción NEXT_REDIRECT que NO debemos tratar como error
        if (err && typeof err === "object" && "digest" in err) {
          const digest = String((err as { digest?: unknown }).digest);
          if (digest.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("No se pudo crear", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border bg-card p-6">
      <fieldset className="space-y-3">
        <Label>Tipo</Label>
        <div className="flex gap-2">
          <label
            className={`flex flex-1 cursor-pointer items-center justify-center rounded-md border px-4 py-3 text-sm font-medium ${
              partyKind === "individual"
                ? "border-primary bg-primary/10 text-primary"
                : "border-input"
            }`}
          >
            <input
              type="radio"
              name="party_kind"
              value="individual"
              checked={partyKind === "individual"}
              onChange={() => setPartyKind("individual")}
              className="sr-only"
            />
            Particular
          </label>
          <label
            className={`flex flex-1 cursor-pointer items-center justify-center rounded-md border px-4 py-3 text-sm font-medium ${
              partyKind === "company" ? "border-primary bg-primary/10 text-primary" : "border-input"
            }`}
          >
            <input
              type="radio"
              name="party_kind"
              value="company"
              checked={partyKind === "company"}
              onChange={() => setPartyKind("company")}
              className="sr-only"
            />
            Empresa
          </label>
        </div>
      </fieldset>

      {partyKind === "company" ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="legal_name">Razón social *</Label>
            <Input id="legal_name" name="legal_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trade_name">Nombre comercial</Label>
            <Input id="trade_name" name="trade_name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax_id">CIF</Label>
            <Input id="tax_id" name="tax_id" placeholder="B12345678" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone_company">Teléfono empresa</Label>
            <Input id="phone_company" name="phone_company" type="tel" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Persona de contacto
            </Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="first_name">Nombre</Label>
            <Input id="first_name" name="first_name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name">Apellidos</Label>
            <Input id="last_name" name="last_name" />
          </div>
        </fieldset>
      ) : (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="first_name">Nombre *</Label>
            <Input id="first_name" name="first_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name">Apellidos</Label>
            <Input id="last_name" name="last_name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax_id">DNI / NIE</Label>
            <Input id="tax_id" name="tax_id" placeholder="12345678A" />
          </div>
        </fieldset>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone_primary">Teléfono *</Label>
          <Input id="phone_primary" name="phone_primary" type="tel" required />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="origin">Origen</Label>
          <select
            id="origin"
            name="origin"
            defaultValue="other"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          >
            {LEAD_ORIGIN.map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABEL[o]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="potential">Potencial</Label>
          <select
            id="potential"
            name="potential"
            defaultValue="unknown"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          >
            {LEAD_POTENTIAL.map((p) => (
              <option key={p} value={p}>
                {p === "unknown" ? "Sin clasificar" : `Clase ${p}`}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <MapPin className="h-4 w-4 text-primary" />
          Dirección principal (opcional)
        </div>
        <p className="text-xs text-muted-foreground">
          Puedes dejarla vacía y añadirla después desde la ficha del lead.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-1.5">
            <Label htmlFor="address_street">Calle</Label>
            <Input id="address_street" name="address_street" placeholder="Gran Vía" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address_street_number">Número</Label>
            <Input id="address_street_number" name="address_street_number" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="address_postal_code">CP</Label>
            <Input
              id="address_postal_code"
              name="address_postal_code"
              inputMode="numeric"
              maxLength={5}
              value={postal}
              onChange={(e) => onPostalChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address_city">Población</Label>
            <Input id="address_city" name="address_city" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address_province">Provincia</Label>
            <Input
              id="address_province"
              name="address_province"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="notes">Notas</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
        />
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href="/leads">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear lead"}
        </Button>
      </div>
    </form>
  );
}
