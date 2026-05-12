"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createFreeTrialAction } from "./actions";

interface ProductOption {
  id: string;
  name: string;
}
interface AddressOption {
  id: string;
  label: string;
}
interface InstallerOption {
  user_id: string;
  full_name: string;
}

interface DraftItem {
  product_id: string;
  quantity: string;
}

export function FreeTrialCreateForm({
  ownerKind,
  ownerId,
  ownerName,
  defaultDurationDays,
  defaultConditionsText,
  products,
  addresses,
  installers,
}: {
  ownerKind: "customer" | "lead";
  ownerId: string;
  ownerName: string;
  defaultDurationDays: number;
  defaultConditionsText: string;
  products: ProductOption[];
  addresses: AddressOption[];
  installers: InstallerOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [items, setItems] = useState<DraftItem[]>([
    { product_id: "", quantity: "1" },
  ]);
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? "");
  const [installerId, setInstallerId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationDays, setDurationDays] = useState(defaultDurationDays);
  const [conditions, setConditions] = useState(defaultConditionsText);
  const [notes, setNotes] = useState("");

  function setItem(idx: number, patch: Partial<DraftItem>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((arr) => [...arr, { product_id: "", quantity: "1" }]);
  }
  function removeItem(idx: number) {
    setItems((arr) => arr.filter((_, i) => i !== idx));
  }

  function submit() {
    const validItems = items
      .filter((it) => it.product_id && Number(it.quantity) > 0)
      .map((it) => {
        const p = products.find((x) => x.id === it.product_id)!;
        return {
          product_id: it.product_id,
          product_name_snapshot: p.name,
          quantity: Math.floor(Number(it.quantity)),
        };
      });
    if (validItems.length === 0) {
      notify.warning("Añade al menos un equipo");
      return;
    }
    if (!addressId) {
      notify.warning("Selecciona dirección de instalación");
      return;
    }
    if (durationDays <= 0) {
      notify.warning("Duración inválida");
      return;
    }
    startTransition(async () => {
      try {
        const newId = await createFreeTrialAction({
          customer_id: ownerKind === "customer" ? ownerId : undefined,
          lead_id: ownerKind === "lead" ? ownerId : undefined,
          installation_address_id: addressId,
          duration_days: durationDays,
          conditions_text: conditions,
          scheduled_at: scheduledAt || undefined,
          assigned_installer_user_id: installerId || undefined,
          notes: notes || undefined,
          items: validItems,
        });
        notify.success("Prueba creada");
        router.push(`/pruebas-gratuitas/${newId}` as never);
      } catch (err) {
        notify.error(
          "No se pudo crear",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Nueva prueba gratuita</h2>
            <p className="text-xs text-muted-foreground">
              Para{" "}
              <Link
                href={
                  (ownerKind === "customer"
                    ? `/clientes/${ownerId}`
                    : `/leads/${ownerId}`) as never
                }
                className="text-primary hover:underline font-semibold"
              >
                {ownerName}
              </Link>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <Link
              href={
                (ownerKind === "customer"
                  ? `/clientes/${ownerId}`
                  : `/leads/${ownerId}`) as never
              }
            >
              <ChevronLeft className="h-4 w-4" /> Volver
            </Link>
          </Button>
        </div>

        {/* Items */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-bold">Equipos en prueba</Label>
            <Button size="sm" variant="outline" onClick={addItem} type="button">
              <Plus className="h-3.5 w-3.5" /> Equipo
            </Button>
          </div>
          {items.map((it, idx) => (
            <div
              key={idx}
              className="grid gap-2 sm:grid-cols-[1fr_90px_auto] items-end rounded-lg border bg-muted/20 p-2"
            >
              <div className="space-y-1">
                <Label className="text-xs">Producto</Label>
                <select
                  value={it.product_id}
                  onChange={(e) => setItem(idx, { product_id: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— Elegir —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cantidad</Label>
                <Input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => setItem(idx, { quantity: e.target.value })}
                  className="h-9"
                />
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
                type="button"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        {/* Programación */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Dirección instalación *</Label>
            {addresses.length === 0 ? (
              <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                Sin direcciones. Añade una desde la ficha del{" "}
                {ownerKind === "customer" ? "cliente" : "lead"}.
              </div>
            ) : (
              <select
                value={addressId}
                onChange={(e) => setAddressId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-1">
            <Label>Instalador (opcional)</Label>
            <select
              value={installerId}
              onChange={(e) => setInstallerId(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">— Sin asignar —</option>
              {installers.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Fecha entrega (opcional)</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              min={(() => {
                const d = new Date();
                d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                return d.toISOString().slice(0, 16);
              })()}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              No se puede programar para una fecha pasada.
            </p>
          </div>
        </div>

        <div className="space-y-1 max-w-xs">
          <Label>Duración (días)</Label>
          <Input
            type="number"
            min={1}
            max={180}
            value={durationDays}
            onChange={(e) => setDurationDays(Number(e.target.value))}
          />
        </div>

        <div className="space-y-1">
          <Label>Condiciones del albarán</Label>
          <p className="text-xs text-muted-foreground">
            Pre-cargadas desde Configuración → Pruebas gratuitas. Puedes
            modificarlas SOLO para esta prueba (no afecta al resto).
          </p>
          <textarea
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-input bg-background p-2 text-sm font-mono"
          />
        </div>

        <div className="space-y-1">
          <Label>Notas internas (opcional)</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-input bg-background p-2 text-sm"
          />
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" asChild type="button">
            <Link
              href={
                (ownerKind === "customer"
                  ? `/clientes/${ownerId}`
                  : `/leads/${ownerId}`) as never
              }
            >
              Cancelar
            </Link>
          </Button>
          <Button
            onClick={submit}
            disabled={pending || addresses.length === 0}
            variant="success"
          >
            <Save className="h-4 w-4" />
            {pending ? "Creando…" : "Crear prueba"}
          </Button>
        </div>
      </div>
    </div>
  );
}
