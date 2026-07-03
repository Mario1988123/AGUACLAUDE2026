"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Save, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { addCustomerEquipmentSafeAction } from "./equipment-actions";
import { addCustomerEquipmentPackAction } from "./equipment-pack-actions";
import { listCompatibleExtras } from "@/modules/products/extra-targets-actions";
import { AddressForm } from "@/modules/addresses/address-form";

interface ExtraLine {
  product_id: string;
  serial: string;
  periodicity: string;
}

interface ProductOption {
  id: string;
  name: string;
}

interface AddressOption {
  id: string;
  label: string;
  is_primary: boolean;
}

interface Props {
  customerId: string;
  ownProducts: ProductOption[];
  addresses?: AddressOption[];
}

type Source = "own" | "external";

export function AddEquipmentButton({
  customerId,
  ownProducts,
  addresses = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const [newAddress, setNewAddress] = useState(false);
  const [source, setSource] = useState<Source>("own");
  const [productId, setProductId] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const defaultAddressId =
    addresses.find((a) => a.is_primary)?.id ?? addresses[0]?.id ?? "";
  const [addressId, setAddressId] = useState(defaultAddressId);
  const [lastMaintenanceAt, setLastMaintenanceAt] = useState("");
  const [nextMaintenanceAt, setNextMaintenanceAt] = useState("");
  const [periodicityMonths, setPeriodicityMonths] = useState("");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState<"" | "cash" | "rental" | "renting">("");
  const [importe, setImporte] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  // Pack: extras que cuelgan del equipo principal (solo catálogo, sin stock).
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [compatibleExtras, setCompatibleExtras] = useState<{ id: string; name: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Al cambiar el equipo principal (catálogo), cargamos sus extras compatibles.
  useEffect(() => {
    if (source !== "own" || !productId) {
      setCompatibleExtras([]);
      return;
    }
    let alive = true;
    listCompatibleExtras({ equipmentProductId: productId, categoryId: null })
      .then((opts) => {
        if (alive) setCompatibleExtras(opts.map((o) => ({ id: o.id, name: o.name })));
      })
      .catch(() => {
        if (alive) setCompatibleExtras([]);
      });
    return () => {
      alive = false;
    };
  }, [source, productId]);

  function addExtra() {
    const first = compatibleExtras[0];
    if (!first) {
      notify.warning("Este equipo no tiene extras compatibles configurados");
      return;
    }
    setExtras((prev) => [...prev, { product_id: first.id, serial: "", periodicity: "" }]);
  }
  function updateExtra(idx: number, patch: Partial<ExtraLine>) {
    setExtras((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function removeExtra(idx: number) {
    setExtras((prev) => prev.filter((_, i) => i !== idx));
  }

  function close() {
    setOpen(false);
    setNewAddress(false);
    setSource("own");
    setProductId("");
    setBrand("");
    setModel("");
    setSerial("");
    setInstalledAt("");
    setLastMaintenanceAt("");
    setNextMaintenanceAt("");
    setPeriodicityMonths("");
    setNotes("");
    setPlan("");
    setImporte("");
    setFechaInicio("");
    setExtras([]);
    setCompatibleExtras([]);
    setAddressId(defaultAddressId);
  }

  function save() {
    if (source === "own" && !productId) {
      notify.warning("Selecciona el producto");
      return;
    }
    if (source === "external" && (!brand.trim() || !model.trim())) {
      notify.warning("Indica marca y modelo");
      return;
    }
    const validExtras = source === "own" ? extras.filter((e) => e.product_id) : [];
    const mainLine = {
      product_id: source === "own" ? productId : null,
      external_brand: source === "external" ? brand : undefined,
      external_model: source === "external" ? model : undefined,
      serial_number: serial || null,
      installed_at: installedAt || null,
      last_maintenance_at: lastMaintenanceAt || null,
      next_maintenance_at: nextMaintenanceAt || null,
      maintenance_periodicity_months: periodicityMonths ? Number(periodicityMonths) : null,
      notes: notes || null,
      acquisition_type: (plan || null) as "cash" | "rental" | "renting" | null,
      acquisition_amount_cents: importe.trim()
        ? Math.round(parseFloat(importe.replace(",", ".")) * 100)
        : null,
      acquisition_started_at: fechaInicio || null,
    };

    startTransition(async () => {
      // Con extras => alta como PACK (principal + extras enlazados). Sin extras =>
      // alta de equipo suelto de siempre.
      if (validExtras.length > 0) {
        const r = await addCustomerEquipmentPackAction({
          customer_id: customerId,
          address_id: addressId || null,
          main: mainLine,
          extras: validExtras.map((e) => ({
            product_id: e.product_id,
            serial_number: e.serial || null,
            installed_at: installedAt || null,
            maintenance_periodicity_months: e.periodicity ? Number(e.periodicity) : null,
            // El extra hereda la modalidad del principal (informativo).
            acquisition_type: mainLine.acquisition_type,
            acquisition_started_at: fechaInicio || null,
          })),
        });
        if (!r.ok) {
          notify.error("No se pudo añadir el pack", r.error);
          return;
        }
        notify.success(`Pack añadido (1 principal + ${r.extraIds.length} extra(s))`);
        close();
        router.refresh();
        return;
      }

      const r = await addCustomerEquipmentSafeAction({
        customer_id: customerId,
        ...mainLine,
        address_id: addressId || null,
      });
      if (!r.ok) {
        notify.error("No se pudo añadir", r.error);
        return;
      }
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
              <h2 className="text-base font-bold">Añadir equipo</h2>
              <button
                type="button"
                onClick={close}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {newAddress ? (
              <div className="flex-1 overflow-y-auto p-4">
                <AddressForm
                  customerId={customerId}
                  onDone={() => {
                    setNewAddress(false);
                    // Forzar reload de addresses para que aparezca en el selector
                    router.refresh();
                  }}
                />
              </div>
            ) : (
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div>
                  <Label className="text-xs">Origen</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSource("own")}
                      className={`rounded-xl border-2 p-2 text-sm font-bold ${
                        source === "own"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      Catálogo
                    </button>
                    <button
                      type="button"
                      onClick={() => setSource("external")}
                      className={`rounded-xl border-2 p-2 text-sm font-bold ${
                        source === "external"
                          ? "border-amber-500 bg-amber-50 text-amber-700"
                          : "border-border bg-card hover:border-amber-300"
                      }`}
                    >
                      Externo
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Dirección</Label>
                    <button
                      type="button"
                      onClick={() => setNewAddress(true)}
                      className="text-xs font-bold text-primary hover:underline"
                    >
                      + Nueva
                    </button>
                  </div>
                  <select
                    value={addressId}
                    onChange={(e) => setAddressId(e.target.value)}
                    className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— Sin asignar —</option>
                    {addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.is_primary ? "★ " : ""}
                        {a.label}
                      </option>
                    ))}
                  </select>
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

                {source === "own" && productId && (
                  <div className="space-y-2 rounded-xl border-2 border-sky-200 bg-sky-50/40 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-sky-900">
                          🧩 Extras del pack
                        </div>
                        <p className="text-[11px] text-sky-800">
                          Añade complementos que se instalan con este equipo (ej. enfriador,
                          grifo). Se registran enlazados al equipo principal.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={addExtra}
                        disabled={compatibleExtras.length === 0}
                      >
                        <Plus className="h-3 w-3" /> Extra
                      </Button>
                    </div>

                    {compatibleExtras.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Este equipo no tiene extras compatibles configurados. Márcalos en la
                        ficha del extra (rol «Extra del configurador» → «¿De qué equipos es
                        extra?»).
                      </p>
                    )}

                    {extras.map((ex, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-end gap-2 rounded-lg border border-sky-200 bg-card p-2"
                      >
                        <div className="min-w-[160px] flex-1 space-y-1">
                          <Label className="text-[11px]">Extra</Label>
                          <select
                            value={ex.product_id}
                            onChange={(e) => updateExtra(idx, { product_id: e.target.value })}
                            className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm"
                          >
                            {compatibleExtras.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="w-28 space-y-1">
                          <Label className="text-[11px]">Nº serie</Label>
                          <Input
                            value={ex.serial}
                            onChange={(e) => updateExtra(idx, { serial: e.target.value })}
                          />
                        </div>
                        <div className="w-24 space-y-1">
                          <Label className="text-[11px]">Mant. (meses)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={60}
                            inputMode="numeric"
                            value={ex.periodicity}
                            onChange={(e) => updateExtra(idx, { periodicity: e.target.value })}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeExtra(idx)}
                          className="rounded-lg p-2 text-destructive hover:bg-muted"
                          aria-label="Quitar extra"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Nº serie</Label>
                    <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Instalado el</Label>
                    <Input
                      type="date"
                      value={installedAt}
                      onChange={(e) => setInstalledAt(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Último mantenimiento</Label>
                    <Input
                      type="date"
                      value={lastMaintenanceAt}
                      onChange={(e) => setLastMaintenanceAt(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Próximo programado</Label>
                    <Input
                      type="date"
                      value={nextMaintenanceAt}
                      onChange={(e) => setNextMaintenanceAt(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Periodicidad de mantenimiento (meses)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    inputMode="numeric"
                    placeholder="Ej. 6 (cada 6 meses)"
                    value={periodicityMonths}
                    onChange={(e) => setPeriodicityMonths(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Si la indicas, se generan automáticamente las visitas del próximo año
                    según esa periodicidad (desde el próximo programado o desde la instalación).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Modalidad (cómo lo tiene el cliente)</Label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <select
                      value={plan}
                      onChange={(e) =>
                        setPlan(e.target.value as "" | "cash" | "rental" | "renting")
                      }
                      className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      <option value="">— Sin definir —</option>
                      <option value="cash">Venta</option>
                      <option value="rental">Alquiler</option>
                      <option value="renting">Renting</option>
                    </select>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder={plan === "cash" ? "Precio €" : "€/mes"}
                      value={importe}
                      onChange={(e) => setImporte(e.target.value)}
                    />
                    <Input
                      type="date"
                      value={fechaInicio}
                      onChange={(e) => setFechaInicio(e.target.value)}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Venta / alquiler / renting + importe (€ de venta o €/mes) y
                    fecha de inicio. Informativo por ahora (contratos en Fase 2).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Notas</Label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                  />
                </div>
              </div>
            )}

            {!newAddress && (
              <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
                <Button variant="outline" onClick={close} disabled={pending}>
                  Cancelar
                </Button>
                <Button onClick={save} disabled={pending}>
                  <Save className="h-3 w-3" /> Guardar
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
