"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Plus, Trash2, Star, Clock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { createBankAccountAction, deleteBankAccountAction, type BankAccountRow } from "./actions";
import { IbanInput } from "@/shared/components/iban-input";
import { checkIbanLive, isPendingIban } from "@/shared/lib/validations/iban-partial";

interface Props {
  customerId: string;
  accounts: BankAccountRow[];
  /** Nombre por defecto del titular (suele ser el del propio cliente). */
  defaultHolderName?: string;
}

function maskIban(iban: string) {
  if (iban.length < 8) return iban;
  return `${iban.slice(0, 4)} **** **** **** ${iban.slice(-4)}`;
}

export function BankAccountList({ customerId, accounts, defaultHolderName }: Props) {
  const [showFull, setShowFull] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    iban: "",
    account_holder_name: defaultHolderName ?? "",
    bic: "",
    bank_name: "",
    is_primary: true,
  });

  function add(e: React.FormEvent) {
    e.preventDefault();
    const check = checkIbanLive(form.iban);
    if (check.state !== "valid" && check.state !== "pending") {
      notify.warning("IBAN no válido — corrige el dígito de control o usa ES00 como pendiente");
      return;
    }
    startTransition(async () => {
      try {
        await createBankAccountAction({ customer_id: customerId, ...form });
        notify.success(
          check.state === "pending"
            ? "IBAN guardado como pendiente — recuerda completarlo antes de la firma"
            : "IBAN añadido",
        );
        setForm({
          iban: "",
          account_holder_name: defaultHolderName ?? "",
          bic: "",
          bank_name: "",
          is_primary: true,
        });
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

      {accounts.map((b) => {
        const pendingIban = isPendingIban(b.iban) || !b.is_validated;
        return (
          <div
            key={b.id}
            className={`rounded-xl border p-4 ${
              pendingIban ? "border-amber-300 bg-amber-50" : "border-border bg-card"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {b.is_primary && (
                    <Badge variant="success">
                      <Star className="h-3 w-3 fill-current" /> Principal
                    </Badge>
                  )}
                  {pendingIban && (
                    <Badge variant="warning">
                      <Clock className="h-3 w-3" /> Pendiente firma
                    </Badge>
                  )}
                  {b.bank_name && <span className="text-sm font-semibold">{b.bank_name}</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                    {pendingIban
                      ? "ES00 · pendiente"
                      : showFull[b.id]
                        ? b.iban
                        : maskIban(b.iban)}
                  </code>
                  {!pendingIban && (
                    <button
                      type="button"
                      onClick={() => setShowFull((s) => ({ ...s, [b.id]: !s[b.id] }))}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Mostrar IBAN"
                    >
                      {showFull[b.id] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  )}
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
        );
      })}

      {adding ? (
        <form onSubmit={add} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="space-y-1.5">
            <Label htmlFor="iban">IBAN *</Label>
            <IbanInput
              id="iban"
              required
              value={form.iban}
              onChange={(v) => setForm({ ...form, iban: v })}
            />
            <p className="text-xs text-muted-foreground">
              Si aún no tienes el IBAN del cliente, escribe <code className="font-mono">ES00</code>{" "}
              y el contrato se podrá firmar quedando como «pendiente de número de cuenta».
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Titular</Label>
              <Input
                value={form.account_holder_name}
                onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })}
                placeholder={defaultHolderName ?? ""}
              />
              {defaultHolderName && (
                <p className="text-xs text-muted-foreground">
                  Por defecto el del cliente. Puedes cambiarlo si el titular es la pareja, otra
                  persona u otra empresa.
                </p>
              )}
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
