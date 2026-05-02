"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  ADDRESS_KIND,
  KIND_LABEL,
  STREET_TYPE,
  STREET_TYPE_LABEL,
  type AddressKind,
  type StreetType,
} from "./schemas";
import { upsertAddressAction } from "./actions";
import { provinceFromPostalCode } from "@/shared/lib/validations/spanish";
import type { AddressRow } from "./actions";

interface Props {
  customerId?: string;
  leadId?: string;
  initial?: AddressRow;
  onDone?: () => void;
}

const EMPTY = {
  kind: "home" as AddressKind,
  label: "",
  is_primary: false,
  contact_name: "",
  contact_phone: "",
  street_type: "calle" as StreetType,
  street: "",
  street_number: "",
  portal: "",
  floor: "",
  door: "",
  postal_code: "",
  city: "",
  province: "",
  notes: "",
};

export function AddressForm({ customerId, leadId, initial, onDone }: Props) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    kind: (initial?.kind ?? EMPTY.kind) as AddressKind,
    label: initial?.label ?? EMPTY.label,
    is_primary: initial?.is_primary ?? EMPTY.is_primary,
    contact_name: initial?.contact_name ?? EMPTY.contact_name,
    contact_phone: initial?.contact_phone ?? EMPTY.contact_phone,
    street_type: (initial?.street_type ?? EMPTY.street_type) as StreetType,
    street: initial?.street ?? EMPTY.street,
    street_number: initial?.street_number ?? EMPTY.street_number,
    portal: initial?.portal ?? EMPTY.portal,
    floor: initial?.floor ?? EMPTY.floor,
    door: initial?.door ?? EMPTY.door,
    postal_code: initial?.postal_code ?? EMPTY.postal_code,
    city: initial?.city ?? EMPTY.city,
    province: initial?.province ?? EMPTY.province,
    notes: initial?.notes ?? EMPTY.notes,
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Auto-sugerir provincia desde CP
      if (key === "postal_code" && typeof value === "string" && value.length === 5) {
        const p = provinceFromPostalCode(value);
        if (p && !next.province) next.province = p;
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await upsertAddressAction({
          ...form,
          id: initial?.id,
          customer_id: customerId,
          lead_id: leadId,
        });
        notify.success(initial ? "Dirección actualizada" : "Dirección añadida");
        onDone?.();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="kind">Tipo</Label>
          <select
            id="kind"
            value={form.kind}
            onChange={(e) => update("kind", e.target.value as AddressKind)}
            className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
          >
            {ADDRESS_KIND.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label">Etiqueta</Label>
          <Input
            id="label"
            value={form.label}
            onChange={(e) => update("label", e.target.value)}
            placeholder="Ej. Sede Madrid"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[180px_1fr_120px]">
        <div className="space-y-1.5">
          <Label>Vía</Label>
          <select
            value={form.street_type}
            onChange={(e) => update("street_type", e.target.value as StreetType)}
            className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
          >
            {STREET_TYPE.map((s) => (
              <option key={s} value={s}>
                {STREET_TYPE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="street">Nombre *</Label>
          <Input
            id="street"
            required
            value={form.street}
            onChange={(e) => update("street", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="street_number">Número</Label>
          <Input
            id="street_number"
            value={form.street_number}
            onChange={(e) => update("street_number", e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Portal</Label>
          <Input value={form.portal} onChange={(e) => update("portal", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Piso</Label>
          <Input value={form.floor} onChange={(e) => update("floor", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Puerta</Label>
          <Input value={form.door} onChange={(e) => update("door", e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>CP *</Label>
          <Input
            inputMode="numeric"
            maxLength={5}
            value={form.postal_code}
            onChange={(e) => update("postal_code", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Población</Label>
          <Input value={form.city} onChange={(e) => update("city", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Provincia</Label>
          <Input value={form.province} onChange={(e) => update("province", e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Persona de contacto</Label>
          <Input
            value={form.contact_name}
            onChange={(e) => update("contact_name", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Teléfono de contacto</Label>
          <Input
            type="tel"
            value={form.contact_phone}
            onChange={(e) => update("contact_phone", e.target.value)}
          />
        </div>
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <input
          type="checkbox"
          checked={form.is_primary}
          onChange={(e) => update("is_primary", e.target.checked)}
          className="h-5 w-5 rounded"
        />
        <span className="text-sm font-semibold">Marcar como dirección principal</span>
      </label>

      <div className="flex justify-end gap-2">
        {onDone && (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : initial ? "Actualizar" : "Añadir dirección"}
        </Button>
      </div>
    </form>
  );
}
