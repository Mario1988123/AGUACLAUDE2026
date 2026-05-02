"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createCustomerAction } from "./actions";
import { TaxIdInput } from "@/shared/components/tax-id-input";
import { DedupeWarning } from "@/shared/components/dedupe-warning";
import { useDedupe } from "@/shared/hooks/use-dedupe";

interface Props {
  sourceLeadId?: string;
}

export function CustomerCreateForm({ sourceLeadId }: Props) {
  const [partyKind, setPartyKind] = useState<"individual" | "company">("individual");
  const [pending, startTransition] = useTransition();
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const dedupeMatches = useDedupe({ tax_id: taxId, email, phone });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (sourceLeadId) fd.set("source_lead_id", sourceLeadId);
    if (taxId) fd.set("tax_id", taxId);
    startTransition(async () => {
      try {
        await createCustomerAction(fd);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
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
              partyKind === "individual" ? "border-primary bg-primary/10 text-primary" : "border-input"
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
            <Label htmlFor="tax_id">CIF *</Label>
            <TaxIdInput
              id="tax_id"
              kind="cif"
              required
              value={taxId}
              onChange={setTaxId}
              placeholder="B12345678"
            />
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
            <Label htmlFor="tax_id">DNI / NIE *</Label>
            <TaxIdInput
              id="tax_id"
              kind="dni"
              required
              value={taxId}
              onChange={setTaxId}
              placeholder="12345678A"
            />
          </div>
        </fieldset>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone_primary">Teléfono *</Label>
          <Input
            id="phone_primary"
            name="phone_primary"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone_secondary">Teléfono secundario</Label>
          <Input id="phone_secondary" name="phone_secondary" type="tel" />
        </div>
      </fieldset>

      <DedupeWarning matches={dedupeMatches} />

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
          <Link href="/clientes">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear cliente"}
        </Button>
      </div>
    </form>
  );
}
