"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Plus, Trash2, Star } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { createBankAccountAction, deleteBankAccountAction, type BankAccountRow } from "./actions";

interface Props {
  customerId: string;
  accounts: BankAccountRow[];
}

function maskIban(iban: string) {
  if (iban.length < 8) return iban;
  return `${iban.slice(0, 4)} **** **** **** ${iban.slice(-4)}`;
}

export function BankAccountList({ customerId, accounts }: Props) {
  const [showFull, setShowFull] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    iban: "",
    account_holder_name: "",
    bic: "",
    bank_name: "",
    is_primary: true,
  });

  function add(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createBankAccountAction({ customer_id: customerId, ...form });
        notify.success("IBAN añadido");
        setForm({ iban: "", account_holder_name: "", bic: "", bank_name: "", is_primary: true });
        setAdding(false);
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function remove(id: string) {
    if (!confirm("¿Eliminar este IBAN?")) return;
    startTransition(async () => {
      try {
        await deleteBankAccountAction(id, customerId);
        notify.success("IBAN eliminado");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-3">
      {accounts.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Sin datos bancarios.
        </div>
      )}

      {accounts.map((b) => (
        <div key={b.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {b.is_primary && (
                  <Badge variant="success">
                    <Star className="h-3 w-3 fill-current" /> Principal
                  </Badge>
                )}
                {b.bank_name && <span className="text-sm font-semibold">{b.bank_name}</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                  {showFull[b.id] ? b.iban : maskIban(b.iban)}
                </code>
                <button
                  type="button"
                  onClick={() => setShowFull((s) => ({ ...s, [b.id]: !s[b.id] }))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Mostrar IBAN"
                >
                  {showFull[b.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {b.account_holder_name && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Titular: {b.account_holder_name}
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(b.id)} disabled={pending}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      ))}

      {adding ? (
        <form onSubmit={add} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="space-y-1.5">
            <Label htmlFor="iban">IBAN *</Label>
            <Input
              id="iban"
              required
              value={form.iban}
              onChange={(e) => setForm({ ...form, iban: e.target.value.toUpperCase() })}
              placeholder="ES00 0000 0000 0000 0000 0000"
              className="font-mono"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Titular</Label>
              <Input
                value={form.account_holder_name}
                onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Banco</Label>
              <Input
                value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                placeholder="Santander, BBVA…"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando..." : "Añadir IBAN"}
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => setAdding(true)} variant="outline" className="w-full">
          <Plus className="h-4 w-4" /> Añadir IBAN
        </Button>
      )}

      <p className="text-xs text-muted-foreground">
        🔒 Solo el administrador de la empresa puede ver y gestionar los datos bancarios.
      </p>
    </div>
  );
}
