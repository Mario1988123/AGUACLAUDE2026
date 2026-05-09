"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { relocateEquipmentAction } from "./relocate-actions";

interface AddressOption {
  id: string;
  label: string;
}

export function RelocateEquipmentButton({
  customerId,
  equipmentId,
  equipmentName,
  currentAddressId,
  addresses,
}: {
  customerId: string;
  equipmentId: string;
  equipmentName: string;
  currentAddressId: string | null;
  addresses: AddressOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Direcciones que NO son la actual
  const targets = addresses.filter((a) => a.id !== currentAddressId);

  const [addressId, setAddressId] = useState(targets[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [feeEur, setFeeEur] = useState("");
  const [feeMethod, setFeeMethod] = useState<
    "cash" | "card" | "transfer" | "domiciliation"
  >("cash");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!addressId) {
      notify.warning("Selecciona la nueva dirección");
      return;
    }
    const feeCents = feeEur.trim()
      ? Math.round(Number(feeEur.replace(",", ".")) * 100)
      : 0;
    startTransition(async () => {
      const r = await relocateEquipmentAction({
        customer_equipment_id: equipmentId,
        new_address_id: addressId,
        scheduled_at: scheduledAt || null,
        fee_cents: feeCents > 0 ? feeCents : null,
        fee_method: feeCents > 0 ? feeMethod : null,
        notes: notes || null,
      });
      if (!r.ok) {
        notify.error("No se pudo crear la reubicación", r.error);
        return;
      }
      notify.success(
        "Reubicación creada",
        feeCents > 0 ? "Cobro pendiente registrado" : undefined,
      );
      setOpen(false);
      router.push(`/instalaciones/${r.installation_id}` as never);
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <MapPin className="h-3.5 w-3.5" /> Reubicar
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-bold">Reubicar equipo</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {equipmentName}
                </p>
              </div>

              <div className="space-y-1">
                <Label>Nueva dirección</Label>
                {targets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    Este cliente solo tiene una dirección. Añade otra desde la
                    sección «Direcciones» antes de reubicar.{" "}
                    <Link
                      href={`/clientes/${customerId}` as never}
                      className="font-bold underline"
                    >
                      Ver direcciones
                    </Link>
                  </div>
                ) : (
                  <select
                    value={addressId}
                    onChange={(e) => setAddressId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    {targets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1">
                <Label>Fecha sugerida (opcional)</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Si la dejas vacía, queda «Sin agendar» y la programa el
                  director técnico.
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                <Label className="text-xs font-bold text-amber-900">
                  💶 Cobro de reubicación (opcional)
                </Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={feeEur}
                    onChange={(e) => setFeeEur(e.target.value)}
                    placeholder="Ej: 60,00"
                  />
                  <select
                    value={feeMethod}
                    onChange={(e) =>
                      setFeeMethod(
                        e.target.value as
                          | "cash"
                          | "card"
                          | "transfer"
                          | "domiciliation",
                      )
                    }
                    className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    <option value="cash">Efectivo</option>
                    <option value="card">Tarjeta</option>
                    <option value="transfer">Transferencia</option>
                    <option value="domiciliation">Domiciliación</option>
                  </select>
                </div>
                <p className="text-xs text-amber-800">
                  Si pones importe se crea un pago pendiente en Wallet
                  asociado al cliente y a la nueva instalación.
                </p>
              </div>

              <div className="space-y-1">
                <Label>Notas</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                  placeholder="Razón de la reubicación, instrucciones para el técnico…"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                onClick={submit}
                disabled={pending || targets.length === 0}
                variant="success"
              >
                {pending ? "Creando…" : "Crear reubicación"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
