"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Plus, Trash2, Loader2 } from "lucide-react";
import {
  addInboundNumberAction,
  toggleInboundNumberAction,
  removeInboundNumberAction,
  type InboundNumberRow,
} from "./inbound-actions";

export function InboundNumbersPanel({ numbers }: { numbers: InboundNumberRow[] }) {
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");

  function onAdd() {
    if (!phone.trim()) return;
    startTransition(async () => {
      const r = await addInboundNumberAction(phone, label);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo dar de alta");
        return;
      }
      setPhone("");
      setLabel("");
      toast.success("Número dado de alta");
    });
  }

  function onToggle(id: string, active: boolean) {
    startTransition(async () => {
      const r = await toggleInboundNumberAction(id, active);
      if (!r.ok) toast.error(r.error ?? "No se pudo cambiar");
    });
  }

  function onRemove(id: string, num: string) {
    startTransition(async () => {
      const r = await removeInboundNumberAction(id);
      if (!r.ok) toast.error(r.error ?? "No se pudo borrar");
      else toast.success(`${num} dado de baja`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="in_phone">Número</Label>
          <Input
            id="in_phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+34911234567"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="in_label">Para qué es (opcional)</Label>
          <Input
            id="in_label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Centralita principal"
          />
        </div>
        <Button type="button" onClick={onAdd} disabled={pending || !phone.trim()}>
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Dar de alta
        </Button>
      </div>

      {numbers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center text-sm text-muted-foreground">
          Sin números dados de alta, la recepcionista no atiende nada. Añade
          arriba el número al que llaman tus clientes.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {numbers.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="font-mono text-sm tabular-nums">{n.phone_e164}</span>
              {n.label && (
                <span className="text-sm text-muted-foreground">{n.label}</span>
              )}
              <div className="ml-auto flex items-center gap-3">
                <Switch
                  checked={n.active}
                  onCheckedChange={(v) => onToggle(n.id, v)}
                  aria-label={`Atender llamadas en ${n.phone_e164}`}
                  disabled={pending}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(n.id, n.phone_e164)}
                  disabled={pending}
                  aria-label={`Dar de baja ${n.phone_e164}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Un número solo puede atender a una empresa: es lo único que identifica de
        quién es la llamada cuando entra. Desactivarlo hace que la plataforma
        desvíe al teléfono de siempre en vez de contestar la IA.
      </p>
    </div>
  );
}
