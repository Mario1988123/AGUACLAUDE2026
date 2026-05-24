"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Package, X, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { addCustomerEquipmentSafeAction } from "./equipment-actions";

interface ProductOption {
  id: string;
  name: string;
}

interface Props {
  customerId: string;
  ownProducts: ProductOption[];
}

type Source = "own" | "external";

export function AddEquipmentButton({ customerId, ownProducts }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>("own");
  const [productId, setProductId] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [lastMaintenanceAt, setLastMaintenanceAt] = useState("");
  const [nextMaintenanceAt, setNextMaintenanceAt] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function close() {
    setOpen(false);
    setSource("own");
    setProductId("");
    setBrand("");
    setModel("");
    setSerial("");
    setInstalledAt("");
    setLastMaintenanceAt("");
    setNextMaintenanceAt("");
    setNotes("");
  }

  function save() {
    if (source === "own" && !productId) {
      notify.warning("Selecciona el producto del catálogo");
      return;
    }
    if (source === "external" && (!brand.trim() || !model.trim())) {
      notify.warning("Indica marca y modelo del equipo externo");
      return;
    }
    startTransition(async () => {
      const r = await addCustomerEquipmentSafeAction({
        customer_id: customerId,
        product_id: source === "own" ? productId : null,
        external_brand: source === "external" ? brand : undefined,
        external_model: source === "external" ? model : undefined,
        serial_number: serial || null,
        installed_at: installedAt || null,
        last_maintenance_at: lastMaintenanceAt || null,
        next_maintenance_at: nextMaintenanceAt || null,
        notes: notes || null,
      });
      if (!r.ok) {
        notify.error("No se pudo añadir el equipo", r.error);
        return;
      }
      notify.success("Equipo añadido al cliente");
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-3 w-3" /> Añadir equipo
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={close}
        >
          <div
            className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-card shadow-2xl sm:my-6 sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl sm:border sm:border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b p-4">
              <div className="min-w-0 flex-1 pr-2">
                <h2 className="text-base font-bold">Añadir equipo al cliente</h2>
                <p className="text-xs text-muted-foreground">
                  Para registrar un equipo ya instalado (incluso por otra empresa)
                  sin pasar por proceso de instalación.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Toggle origen del equipo */}
              <div>
                <Label className="text-xs">Origen del equipo</Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSource("own")}
                    className={`rounded-xl border-2 p-3 text-sm font-bold ${
                      source === "own"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <Package className="mx-auto h-4 w-4" />
                    Nuestro catálogo
                  </button>
                  <button
                    type="button"
                    onClick={() => setSource("external")}
                    className={`rounded-xl border-2 p-3 text-sm font-bold ${
                      source === "external"
                        ? "border-amber-500 bg-amber-50 text-amber-700"
                        : "border-border bg-card hover:border-amber-300"
                    }`}
                  >
                    <Package className="mx-auto h-4 w-4" />
                    Otra empresa
                  </button>
                </div>
              </div>

              {source === "own" ? (
                <div className="space-y-1.5">
                  <Label>Producto</Label>
                  <select
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— Selecciona —</option>
                    {ownProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Marca *</Label>
                    <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Modelo *</Label>
                    <Input value={model} onChange={(e) => setModel(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nº de serie (opcional)</Label>
                  <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Fecha de instalación (estimada)</Label>
                  <Input
                    type="date"
                    value={installedAt}
                    onChange={(e) => setInstalledAt(e.target.value)}
                  />
                </div>
              </div>

              {/* Ciclo de mantenimiento — opcional pero clave para equipos
                  que llegan a mitad de ciclo desde otro proveedor. */}
              <div className="space-y-2 rounded-xl border-2 border-primary/20 bg-primary/5 p-3">
                <Label className="text-sm font-bold text-primary">
                  Ciclo de mantenimiento (opcional)
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Si el equipo está a mitad de ciclo (ya tenía mantenimiento
                  hecho por otra empresa), rellena estas fechas para que el
                  sistema calcule correctamente cuándo toca el siguiente.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Último mantenimiento conocido</Label>
                    <Input
                      type="date"
                      value={lastMaintenanceAt}
                      onChange={(e) => setLastMaintenanceAt(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Se registra como un job retroactivo (sin técnico).
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Próxima visita programada</Label>
                    <Input
                      type="date"
                      value={nextMaintenanceAt}
                      onChange={(e) => setNextMaintenanceAt(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Crea un job scheduled para esa fecha.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Notas (opcional)</Label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                  placeholder="Ej. instalado en 2020 por la empresa X, requiere mantenimiento anual…"
                />
              </div>

              {source === "external" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  💡 Este equipo se registra para poder ofrecer contrato de
                  mantenimiento al cliente. NO se decrementa stock ni se crea
                  parte de instalación.
                </div>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending}>
                <Save className="h-3 w-3" /> Añadir equipo
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
