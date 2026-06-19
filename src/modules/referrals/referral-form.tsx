"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { PhoneInput } from "@/shared/components/phone-input";
import {
  createReferralLeadAction,
  searchReferralCustomersAction,
  type CustomerHit,
} from "./actions";

interface Props {
  /** Si se pasa, el cliente recomendador es fijo (uso desde la ficha). */
  presetCustomer?: { id: string; name: string };
  triggerLabel?: string;
}

export function ReferralForm({ presetCustomer, triggerLabel = "Añadir referido" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [customer, setCustomer] = useState<CustomerHit | null>(
    presetCustomer ? { id: presetCustomer.id, name: presetCustomer.name } : null,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  function reset() {
    setCustomer(presetCustomer ? { id: presetCustomer.id, name: presetCustomer.name } : null);
    setQuery("");
    setResults([]);
    setName("");
    setPhone("");
  }

  function runSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    startTransition(async () => {
      const hits = await searchReferralCustomersAction(q);
      setResults(hits);
      setSearching(false);
    });
  }

  function submit() {
    if (!customer) {
      notify.error("Falta el cliente", "Elige el cliente que recomienda.");
      return;
    }
    if (name.trim().length < 2) {
      notify.error("Falta el nombre", "Escribe el nombre del amigo recomendado.");
      return;
    }
    startTransition(async () => {
      const r = await createReferralLeadAction({
        customer_id: customer.id,
        name: name.trim(),
        phone: phone.trim() || undefined,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Referido añadido", "Entra como lead nuevo listo para contactar.");
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {triggerLabel}
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      {/* Cliente recomendador */}
      {!presetCustomer && (
        <div className="space-y-1.5">
          <Label>Cliente que recomienda</Label>
          {customer ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
              <span className="truncate text-sm font-medium">{customer.name}</span>
              <button
                type="button"
                onClick={() => setCustomer(null)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Quitar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => runSearch(e.target.value)}
                  placeholder="Busca el cliente por nombre o teléfono…"
                  className="pl-9"
                />
              </div>
              {searching && <p className="text-xs text-muted-foreground">Buscando…</p>}
              {results.length > 0 && (
                <ul className="max-h-48 overflow-auto rounded-xl border border-border">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomer(c);
                          setResults([]);
                          setQuery("");
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ref-name">Nombre del amigo *</Label>
          <Input
            id="ref-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre y apellidos"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Teléfono</Label>
          <PhoneInput value={phone} onChange={setPhone} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancelar
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Guardando…" : "Guardar referido"}
        </Button>
      </div>
    </div>
  );
}
