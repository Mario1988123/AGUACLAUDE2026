"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { upsertWarehouseAction, deleteWarehouseAction, type WarehouseRow } from "./actions";
import { KIND_LABEL } from "./constants";

interface Props {
  warehouses: WarehouseRow[];
  teamMembers?: { user_id: string; full_name: string }[];
}

export function WarehousesManager({ warehouses, teamMembers = [] }: Props) {
  const [editing, setEditing] = useState<WarehouseRow | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();

  async function remove(id: string) {
    const ok = await ask({
      message: "¿Eliminar este almacén?",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteWarehouseAction(id);
        notify.success("Eliminado");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (editing) {
    return (
      <WarehouseForm
        initial={editing === "new" ? null : editing}
        teamMembers={teamMembers}
        onDone={() => {
          setEditing(null);
          location.reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {warehouses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Sin almacenes. Crea el primero.
        </div>
      ) : (
        warehouses.map((w) => (
          <div
            key={w.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{w.name}</span>
                <Badge variant="outline">{KIND_LABEL[w.kind]}</Badge>
                {w.vehicle_plate && <Badge variant="secondary">{w.vehicle_plate}</Badge>}
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="icon" asChild aria-label="Ver almacén">
                <Link href={`/almacenes/${w.id}` as never} title="Ver stock, traspasos, inventario, historial">
                  <Eye className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setEditing(w)} aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(w.id)}
                disabled={pending}
                aria-label="Eliminar"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))
      )}
      <Button onClick={() => setEditing("new")} variant="outline" className="w-full">
        <Plus className="h-4 w-4" /> Nuevo almacén
      </Button>
    </div>
  );
}

function WarehouseForm({
  initial,
  teamMembers,
  onDone,
}: {
  initial: WarehouseRow | null;
  teamMembers: { user_id: string; full_name: string }[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    kind: (initial?.kind ?? "main") as "main" | "secondary" | "vehicle" | "external_supplier",
    vehicle_plate: initial?.vehicle_plate ?? "",
    assigned_user_id: initial?.assigned_user_id ?? "",
    address_street: initial?.address_street ?? "",
    address_postal_code: initial?.address_postal_code ?? "",
    address_city: initial?.address_city ?? "",
    address_province: initial?.address_province ?? "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await upsertWarehouseAction({
          id: initial?.id,
          name: form.name,
          kind: form.kind,
          vehicle_plate: form.vehicle_plate,
          assigned_user_id: form.assigned_user_id || null,
          address_street: form.address_street,
          address_postal_code: form.address_postal_code,
          address_city: form.address_city,
          address_province: form.address_province,
        });
        notify.success("Guardado");
        onDone();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  const showAddressFields = form.kind === "main" || form.kind === "secondary";

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kind">Tipo</Label>
              <select
                id="kind"
                value={form.kind}
                onChange={(e) =>
                  setForm({
                    ...form,
                    kind: e.target.value as typeof form.kind,
                  })
                }
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {form.kind === "vehicle" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plate">Matrícula</Label>
                <Input
                  id="plate"
                  value={form.vehicle_plate}
                  onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value })}
                  placeholder="0000-AAA"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user">Instalador asignado</Label>
                <select
                  id="user"
                  value={form.assigned_user_id}
                  onChange={(e) => setForm({ ...form, assigned_user_id: e.target.value })}
                  className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
                >
                  <option value="">Sin asignar</option>
                  {teamMembers.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {showAddressFields && (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
              <p className="text-xs font-bold uppercase text-muted-foreground">
                Dirección física
              </p>
              <p className="text-[11px] text-muted-foreground -mt-2">
                Necesaria para el origen de las rutas. Las coordenadas se calculan
                automáticamente al guardar.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="address_street">Calle y número</Label>
                <Input
                  id="address_street"
                  value={form.address_street}
                  onChange={(e) => setForm({ ...form, address_street: e.target.value })}
                  placeholder="Ej. Calle Mayor 12"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="address_postal_code">CP</Label>
                  <Input
                    id="address_postal_code"
                    value={form.address_postal_code}
                    onChange={(e) =>
                      setForm({ ...form, address_postal_code: e.target.value })
                    }
                    placeholder="28001"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="address_city">Ciudad</Label>
                  <Input
                    id="address_city"
                    value={form.address_city}
                    onChange={(e) => setForm({ ...form, address_city: e.target.value })}
                    placeholder="Madrid"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="address_province">Provincia</Label>
                  <Input
                    id="address_province"
                    value={form.address_province}
                    onChange={(e) =>
                      setForm({ ...form, address_province: e.target.value })
                    }
                    placeholder="Madrid"
                  />
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando..." : initial ? "Actualizar" : "Crear"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
