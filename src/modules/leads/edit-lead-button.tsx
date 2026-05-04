"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateLeadAction } from "./actions";
import { TaxIdInput } from "@/shared/components/tax-id-input";
import { LEAD_POTENTIAL } from "./schemas";

interface Props {
  leadId: string;
  initial: {
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_primary: string | null;
    phone_company: string | null;
    tax_id: string | null;
    notes: string | null;
    potential: "unknown" | "A" | "B" | "C";
  };
}

export function EditLeadButton({ leadId, initial }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState(initial);

  function close() {
    setOpen(false);
    setForm(initial);
  }

  function save() {
    startTransition(async () => {
      try {
        await updateLeadAction(leadId, form);
        notify.success("Lead actualizado");
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> Editar
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
          onClick={close}
        >
          <div
            className="my-6 w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="text-base font-bold">Editar lead</h2>
              <button
                type="button"
                onClick={close}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              {form.party_kind === "company" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Razón social</Label>
                    <Input
                      value={form.legal_name ?? ""}
                      onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nombre comercial</Label>
                    <Input
                      value={form.trade_name ?? ""}
                      onChange={(e) => setForm({ ...form, trade_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>CIF</Label>
                    <TaxIdInput
                      kind="cif"
                      value={form.tax_id ?? ""}
                      onChange={(v) => setForm({ ...form, tax_id: v })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tel. empresa</Label>
                    <Input
                      type="tel"
                      value={form.phone_company ?? ""}
                      onChange={(e) => setForm({ ...form, phone_company: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Persona de contacto
                    </Label>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nombre</Label>
                    <Input
                      value={form.first_name ?? ""}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Apellidos</Label>
                    <Input
                      value={form.last_name ?? ""}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Nombre</Label>
                    <Input
                      value={form.first_name ?? ""}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Apellidos</Label>
                    <Input
                      value={form.last_name ?? ""}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>DNI / NIE</Label>
                    <TaxIdInput
                      kind="dni"
                      value={form.tax_id ?? ""}
                      onChange={(v) => setForm({ ...form, tax_id: v })}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email ?? ""}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Teléfono</Label>
                  <Input
                    type="tel"
                    value={form.phone_primary ?? ""}
                    onChange={(e) => setForm({ ...form, phone_primary: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Potencial</Label>
                <select
                  value={form.potential}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      potential: e.target.value as typeof form.potential,
                    })
                  }
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                >
                  {LEAD_POTENTIAL.map((p) => (
                    <option key={p} value={p}>
                      {p === "unknown" ? "Sin clasificar" : `Clase ${p}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Notas</Label>
                <textarea
                  rows={4}
                  value={form.notes ?? ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-xl border border-input bg-background p-3 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t bg-muted/20 p-4">
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending}>
                <Save className="h-4 w-4" /> {pending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
