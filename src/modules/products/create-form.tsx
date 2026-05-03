"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createProductAction } from "./actions";
import { KIND_LABEL, PRODUCT_KIND } from "./schemas";
import type { CategoryItem } from "./types";

/**
 * Wizard 2 pasos: datos básicos + dimensiones / costes y pricing inicial.
 * Tablet-first.
 */
export function ProductCreateForm({ categories }: { categories: CategoryItem[] }) {
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();

  // Paso 1
  const [name, setName] = useState("");
  const [kind, setKind] = useState("equipment");
  const [categoryId, setCategoryId] = useState("");
  const [internalRef, setInternalRef] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [weight, setWeight] = useState("");

  // Paso 2
  const [cost, setCost] = useState("");
  const [supplierPrice, setSupplierPrice] = useState("");
  const [stockMin, setStockMin] = useState("0");
  const [stockManaged, setStockManaged] = useState(true);
  const [cashTotal, setCashTotal] = useState("");
  const [cashMin, setCashMin] = useState("");
  const [cashAbsMin, setCashAbsMin] = useState("");

  function validateStep1(): boolean {
    if (!name.trim()) {
      notify.warning("Nombre obligatorio");
      return false;
    }
    return true;
  }

  function next() {
    if (step === 1 && !validateStep1()) return;
    setStep((s) => Math.min(2, s + 1));
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
  }

  function submit() {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    const fd = new FormData();
    fd.set("name", name);
    fd.set("kind", kind);
    fd.set("category_id", categoryId);
    fd.set("internal_reference", internalRef);
    fd.set("supplier_reference", supplierRef);
    fd.set("short_description", shortDesc);
    fd.set("dim_width_mm", width);
    fd.set("dim_height_mm", height);
    fd.set("dim_depth_mm", depth);
    fd.set("weight_grams", weight);
    // Los inputs de la UI son EUROS (con decimales). El backend espera céntimos.
    const eurToCents = (v: string): string => {
      if (!v) return "";
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n)) return "";
      return String(Math.round(n * 100));
    };
    fd.set("cost_cents", eurToCents(cost));
    fd.set("supplier_price_cents", eurToCents(supplierPrice));
    fd.set("stock_min", stockMin);
    if (stockManaged) fd.set("stock_managed", "on");
    fd.set("cash_total_cents", eurToCents(cashTotal));
    fd.set("cash_min_authorized_cents", eurToCents(cashMin));
    fd.set("cash_absolute_min_cents", eurToCents(cashAbsMin));
    startTransition(async () => {
      try {
        await createProductAction(fd);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {[1, 2].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  n < step
                    ? "bg-success text-success-foreground"
                    : n === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {n < step ? <Check className="h-4 w-4" /> : n}
              </div>
              {n < 2 && <div className={`h-0.5 w-8 ${n < step ? "bg-success" : "bg-muted"}`} />}
            </div>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">
          Paso {step} de 2 · {step === 1 ? "Datos básicos" : "Costes, stock y precio"}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
              >
                {PRODUCT_KIND.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Categoría</Label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Referencia interna</Label>
              <Input value={internalRef} onChange={(e) => setInternalRef(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Referencia proveedor</Label>
              <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Descripción corta</Label>
              <Input value={shortDesc} onChange={(e) => setShortDesc(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Dimensiones (mm) — opcional
            </Label>
            <div className="grid gap-3 sm:grid-cols-4">
              <Input
                placeholder="Ancho"
                type="number"
                min={0}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
              <Input
                placeholder="Alto"
                type="number"
                min={0}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
              <Input
                placeholder="Fondo"
                type="number"
                min={0}
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
              />
              <Input
                placeholder="Peso (g)"
                type="number"
                min={0}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Coste (€)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="200,63"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Precio proveedor (€)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="200,63"
                value={supplierPrice}
                onChange={(e) => setSupplierPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Stock mínimo</Label>
              <Input
                type="number"
                min={0}
                value={stockMin}
                onChange={(e) => setStockMin(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 self-end rounded-xl border border-border bg-muted/30 p-3 sm:col-span-3">
              <input
                type="checkbox"
                checked={stockManaged}
                onChange={(e) => setStockManaged(e.target.checked)}
                className="h-5 w-5"
              />
              <span className="text-sm font-semibold">Controlar stock de este producto</span>
            </label>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Plan precio inicial (contado) — opcional
            </Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">PVP (€)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="200,63"
                  value={cashTotal}
                  onChange={(e) => setCashTotal(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mín. comercial (€)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={cashMin}
                  onChange={(e) => setCashMin(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mín. absoluto (€)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={cashAbsMin}
                  onChange={(e) => setCashAbsMin(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Mínimo comercial: precio que el comercial puede vender sin pedir aprobación.
              Mínimo absoluto: precio mínimo con aprobación de director/admin.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        {step > 1 ? (
          <Button variant="outline" onClick={back} disabled={pending}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link href="/productos">Cancelar</Link>
          </Button>
        )}
        {step < 2 ? (
          <Button onClick={next} disabled={pending}>
            Siguiente <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={pending} variant="success" size="lg">
            {pending ? "Creando..." : "Crear producto"}
          </Button>
        )}
      </div>
    </div>
  );
}
