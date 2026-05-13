"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createCustomerAction } from "./actions";
import { TaxIdInput } from "@/shared/components/tax-id-input";
import { PhoneInput } from "@/shared/components/phone-input";
import { DedupeWarning } from "@/shared/components/dedupe-warning";
import { useDedupe } from "@/shared/hooks/use-dedupe";

interface Props {
  sourceLeadId?: string;
}

/**
 * Wizard 2 pasos: identidad/contacto + notas. (La dirección y banco se añaden
 * en la ficha del cliente, no aquí, para no duplicar.)
 */
export function CustomerCreateForm({ sourceLeadId }: Props) {
  const [step, setStep] = useState(1);
  const [partyKind, setPartyKind] = useState<"individual" | "company">("individual");
  const [pending, startTransition] = useTransition();

  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneSecondary, setPhoneSecondary] = useState("");
  const [notes, setNotes] = useState("");
  /** Toggle "Autónomo" — solo significativo si partyKind=company. */
  const [isAutonomo, setIsAutonomo] = useState(false);

  const dedupeMatches = useDedupe({ tax_id: taxId, email, phone });

  function validateStep1(): boolean {
    if (partyKind === "company" && !legalName.trim()) {
      notify.warning("Razón social obligatoria");
      return false;
    }
    if (partyKind === "individual" && !firstName.trim()) {
      notify.warning("Nombre obligatorio");
      return false;
    }
    if (!taxId.trim()) {
      notify.warning("DNI/CIF obligatorio en cliente");
      return false;
    }
    if (!phone.trim()) {
      notify.warning("Teléfono obligatorio");
      return false;
    }
    return true;
  }

  function next() {
    if (!validateStep1()) return;
    setStep(2);
  }
  function back() {
    setStep(1);
  }

  function submit() {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    const fd = new FormData();
    fd.set("party_kind", partyKind);
    fd.set(
      "is_autonomo",
      partyKind === "company" && isAutonomo ? "true" : "false",
    );
    fd.set("legal_name", legalName);
    fd.set("trade_name", tradeName);
    fd.set("first_name", firstName);
    fd.set("last_name", lastName);
    fd.set("tax_id", taxId);
    fd.set("email", email);
    fd.set("phone_primary", phone);
    fd.set("phone_secondary", phoneSecondary);
    fd.set("notes", notes);
    if (sourceLeadId) fd.set("source_lead_id", sourceLeadId);
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
    <div className="space-y-4 rounded-2xl border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {[1, 2].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  n < step
                    ? "bg-success text-success-foreground"
                    : n === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {n < step ? <Check className="h-4 w-4" /> : n}
              </div>
              {n < 2 && <div className={`h-0.5 w-8 ${n < step ? "bg-success" : "bg-muted"}`} />}
            </div>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">
          Paso {step} de 2 · {step === 1 ? "Identidad y contacto" : "Notas"}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div className="space-y-3">
            <Label>Tipo</Label>
            <div className="flex gap-2">
              <label
                className={`flex flex-1 cursor-pointer items-center justify-center rounded-xl border-2 px-4 py-4 text-sm font-semibold ${
                  partyKind === "individual"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input"
                }`}
              >
                <input
                  type="radio"
                  value="individual"
                  checked={partyKind === "individual"}
                  onChange={() => setPartyKind("individual")}
                  className="sr-only"
                />
                Particular
              </label>
              <label
                className={`flex flex-1 cursor-pointer items-center justify-center rounded-xl border-2 px-4 py-4 text-sm font-semibold ${
                  partyKind === "company"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input"
                }`}
              >
                <input
                  type="radio"
                  value="company"
                  checked={partyKind === "company"}
                  onChange={() => setPartyKind("company")}
                  className="sr-only"
                />
                Empresa
              </label>
            </div>
          </div>

          {partyKind === "company" ? (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-amber-200 bg-amber-50/40 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={isAutonomo}
                  onChange={(e) => setIsAutonomo(e.target.checked)}
                  className="h-5 w-5 rounded"
                />
                <div className="flex-1">
                  <div className="font-bold">Autónomo</div>
                  <div className="text-xs text-muted-foreground">
                    Persona física con actividad económica. A efectos de
                    precio se trata como empresa (base + IVA) y limita qué
                    financieras pueden ofrecerse en renting.
                  </div>
                </div>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Razón social *</Label>
                  <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Nombre comercial</Label>
                  <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{isAutonomo ? "CIF / NIF *" : "CIF *"}</Label>
                  <TaxIdInput kind="cif" value={taxId} onChange={setTaxId} required placeholder={isAutonomo ? "B/12345678 o 12345678A" : "B12345678"} />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Apellidos</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>DNI / NIE *</Label>
                <TaxIdInput kind="dni" value={taxId} onChange={setTaxId} required placeholder="12345678A" />
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono *</Label>
              <PhoneInput value={phone} onChange={setPhone} required />
            </div>
            <div className="space-y-2">
              <Label>Teléfono secundario</Label>
              <PhoneInput value={phoneSecondary} onChange={setPhoneSecondary} />
            </div>
          </div>

          <DedupeWarning matches={dedupeMatches} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <Label>Notas</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-input bg-background p-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            La dirección y los datos bancarios los añadirás desde la ficha del cliente (con mapa).
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        {step > 1 ? (
          <Button variant="outline" onClick={back} disabled={pending}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link href="/clientes">Cancelar</Link>
          </Button>
        )}
        {step < 2 ? (
          <Button onClick={next} disabled={pending}>
            Siguiente <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={pending} variant="success" size="lg">
            {pending ? "Creando..." : "Crear cliente"}
          </Button>
        )}
      </div>
    </div>
  );
}
