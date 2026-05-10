"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { updateCustomerAction } from "./actions";

export interface EditCustomerInitial {
  party_kind: "individual" | "company";
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_primary: string | null;
  phone_secondary: string | null;
  tax_id: string | null;
  notes: string | null;
}

export function EditCustomerDataButton({
  customerId,
  initial,
}: {
  customerId: string;
  initial: EditCustomerInitial;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set<K extends keyof EditCustomerInitial>(
    key: K,
    val: EditCustomerInitial[K],
  ) {
    setV((x) => ({ ...x, [key]: val }));
  }

  function save() {
    startTransition(async () => {
      try {
        await updateCustomerAction(customerId, {
          legal_name: v.legal_name,
          trade_name: v.trade_name,
          first_name: v.first_name,
          last_name: v.last_name,
          email: v.email,
          phone_primary: v.phone_primary,
          phone_secondary: v.phone_secondary,
          tax_id: v.tax_id,
          notes: v.notes,
        });
        notify.success("Datos actualizados");
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setV(initial);
          setOpen(true);
        }}
      >
        <Pencil className="h-4 w-4" /> Editar
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar datos del cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {v.party_kind === "company" ? (
              <>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Razón social</Label>
                  <Input
                    value={v.legal_name ?? ""}
                    onChange={(e) => set("legal_name", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Nombre comercial</Label>
                  <Input
                    value={v.trade_name ?? ""}
                    onChange={(e) => set("trade_name", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>CIF</Label>
                  <Input
                    value={v.tax_id ?? ""}
                    onChange={(e) => set("tax_id", e.target.value || null)}
                    placeholder="B12345678"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Persona contacto</Label>
                  <Input
                    value={`${v.first_name ?? ""} ${v.last_name ?? ""}`.trim()}
                    onChange={(e) => {
                      const parts = e.target.value.split(/\s+/);
                      set("first_name", parts[0] ?? null);
                      set("last_name", parts.slice(1).join(" ") || null);
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Nombre</Label>
                  <Input
                    value={v.first_name ?? ""}
                    onChange={(e) => set("first_name", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Apellidos</Label>
                  <Input
                    value={v.last_name ?? ""}
                    onChange={(e) => set("last_name", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>DNI / NIE</Label>
                  <Input
                    value={v.tax_id ?? ""}
                    onChange={(e) => set("tax_id", e.target.value || null)}
                    placeholder="12345678X"
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={v.email ?? ""}
                onChange={(e) => set("email", e.target.value || null)}
                placeholder="cliente@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input
                value={v.phone_primary ?? ""}
                onChange={(e) => set("phone_primary", e.target.value || null)}
                placeholder="+34 6XX XXX XXX"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tel. secundario</Label>
              <Input
                value={v.phone_secondary ?? ""}
                onChange={(e) => set("phone_secondary", e.target.value || null)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notas</Label>
              <textarea
                rows={3}
                value={v.notes ?? ""}
                onChange={(e) => set("notes", e.target.value || null)}
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending} variant="success">
              {pending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
