"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createProductSafeAction } from "./actions";
import { KIND_LABEL, PRODUCT_KIND, PRODUCT_ROLES, ROLE_LABEL, ROLE_HELP, type ProductRole } from "./schemas";
import { listAttributes, type ProductAttribute } from "./attributes-actions";
import type { CategoryItem } from "./types";

/**
 * Wizard 3 pasos: datos básicos + costes/pricing + atributos por categoría.
 * Tablet-first. El paso 3 carga los atributos definidos en la categoría
 * (product_attributes con category_id = categoría elegida) y permite
 * rellenarlos en bloque antes de crear el producto.
 */
export function ProductCreateForm({ categories }: { categories: CategoryItem[] }) {
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [categoryAttrs, setCategoryAttrs] = useState<ProductAttribute[]>([]);
  const [attrLoading, setAttrLoading] = useState(false);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});

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

  // Paso 2 — el coste real ya NO se introduce: se calcula como CMP a partir
  // de las facturas de compra. Aquí solo definimos PVP y datos de stock.
  const [stockMin, setStockMin] = useState("0");
  const [stockManaged, setStockManaged] = useState(true);
  const [cashTotal, setCashTotal] = useState("");
  const [cashMin, setCashMin] = useState("");
  const [cashAbsMin, setCashAbsMin] = useState("");
  // Roles (Fase B): por defecto vendible suelto (igual que el comportamiento actual).
  const [roles, setRoles] = useState<string[]>(["sellable_standalone"]);
  function toggleRole(r: ProductRole) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  function validateStep1(): boolean {
    if (!name.trim()) {
      notify.warning("Nombre obligatorio");
      return false;
    }
    return true;
  }

  function next() {
    if (step === 1 && !validateStep1()) return;
    setStep((s) => Math.min(3, s + 1));
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
  }

  // Cuando llegamos al paso 3, cargamos atributos de la categoría elegida.
  // Si el usuario cambia de categoría, se vuelve a cargar.
  useEffect(() => {
    if (step !== 3) return;
    let cancelled = false;
    setAttrLoading(true);
    listAttributes(categoryId || null)
      .then((rows) => {
        if (cancelled) return;
        setCategoryAttrs(rows);
        setAttrValues((prev) => {
          const next: Record<string, string> = {};
          for (const a of rows) next[a.id] = prev[a.id] ?? "";
          return next;
        });
      })
      .catch(() => setCategoryAttrs([]))
      .finally(() => {
        if (!cancelled) setAttrLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, categoryId]);

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
    // No enviamos cost_cents ni supplier_price_cents: el coste se calcula
    // automáticamente desde las compras (CMP).
    fd.set("stock_min", stockMin);
    if (stockManaged) fd.set("stock_managed", "on");
    fd.set("cash_total_cents", eurToCents(cashTotal));
    fd.set("cash_min_authorized_cents", eurToCents(cashMin));
    fd.set("cash_absolute_min_cents", eurToCents(cashAbsMin));
    fd.set("roles", JSON.stringify(roles));

    // Atributos por categoría: serializar como JSON respetando el data_type
    if (categoryAttrs.length > 0) {
      const payload = categoryAttrs
        .map((a) => {
          const raw = (attrValues[a.id] ?? "").trim();
          if (raw === "") return null;
          if (a.data_type === "boolean") {
            return { attribute_id: a.id, value_boolean: raw === "true" };
          }
          if (a.data_type === "number" || a.data_type === "dimension") {
            const n = Number(raw.replace(",", "."));
            if (!Number.isFinite(n)) return null;
            return { attribute_id: a.id, value_number: n };
          }
          return { attribute_id: a.id, value_text: raw };
        })
        .filter(Boolean);
      if (payload.length > 0) {
        fd.set("attribute_values", JSON.stringify(payload));
      }
    }

    startTransition(async () => {
      try {
        const r = await createProductSafeAction(fd);
        // El éxito redirige (lanza NEXT_REDIRECT). Si vuelve un objeto, es error.
        if (r && !r.ok) {
          notify.error("Error", r.error || "No se pudo crear el producto");
        }
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
          {[1, 2, 3].map((n) => (
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
              {n < 3 && <div className={`h-0.5 w-8 ${n < step ? "bg-success" : "bg-muted"}`} />}
            </div>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">
          Paso {step} de 3 ·{" "}
          {step === 1
            ? "Datos básicos"
            : step === 2
              ? "Costes, stock y precio"
              : "Atributos de la categoría"}
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
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            💡 El <strong>coste real del producto</strong> se calcula
            automáticamente como coste medio ponderado (CMP) a partir de
            las facturas de compra que registres en el almacén. Por eso
            aquí solo defines el <strong>precio de venta</strong> (PVP) y
            la gestión de stock.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Stock mínimo</Label>
              <Input
                type="number"
                min={0}
                value={stockMin}
                onChange={(e) => setStockMin(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 self-end rounded-xl border border-border bg-muted/30 p-3">
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

          <div className="space-y-2 rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4">
            <Label className="text-sm font-bold text-emerald-900">
              🧩 ¿Cómo se usa este producto?
            </Label>
            <p className="text-[11px] text-emerald-800">
              Marca todo lo que aplique. Se puede cambiar después desde la ficha.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRODUCT_ROLES.map((r) => (
                <label
                  key={r}
                  className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-card p-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={roles.includes(r)}
                    onChange={() => toggleRole(r)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
                    <span className="block text-[11px] text-muted-foreground">{ROLE_HELP[r]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {!categoryId && (
            <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              No has elegido categoría — por eso no hay atributos predefinidos.
              Puedes crear el producto y añadirlos manualmente desde la ficha.
            </div>
          )}
          {categoryId && attrLoading && (
            <p className="text-sm text-muted-foreground">Cargando atributos…</p>
          )}
          {categoryId && !attrLoading && categoryAttrs.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm">
              Esta categoría aún no tiene atributos definidos.
              <br />
              Puedes crear el producto y añadir atributos desde la ficha, o
              definirlos primero en{" "}
              <Link
                href="/configuracion/productos"
                className="font-semibold text-primary hover:underline"
              >
                Configuración → Productos
              </Link>
              .
            </div>
          )}
          {categoryId && !attrLoading && categoryAttrs.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Rellena los atributos que correspondan. Los que dejes vacíos no
                se guardarán y podrás añadirlos más tarde desde la ficha.
              </p>
              {categoryAttrs.map((a) => (
                <div key={a.id} className="grid gap-2 sm:grid-cols-3 sm:items-center">
                  <Label className="sm:col-span-1">
                    {a.name}
                    {a.unit ? ` (${a.unit})` : ""}
                    {a.is_required && <span className="text-destructive"> *</span>}
                  </Label>
                  <div className="sm:col-span-2">
                    {a.data_type === "boolean" ? (
                      <select
                        value={attrValues[a.id] ?? ""}
                        onChange={(e) =>
                          setAttrValues((p) => ({ ...p, [a.id]: e.target.value }))
                        }
                        className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                      >
                        <option value="">—</option>
                        <option value="true">Sí</option>
                        <option value="false">No</option>
                      </select>
                    ) : a.data_type === "enum" && a.enum_values?.length ? (
                      <select
                        value={attrValues[a.id] ?? ""}
                        onChange={(e) =>
                          setAttrValues((p) => ({ ...p, [a.id]: e.target.value }))
                        }
                        className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                      >
                        <option value="">— Elegir —</option>
                        {a.enum_values.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        type={
                          a.data_type === "number" || a.data_type === "dimension"
                            ? "number"
                            : "text"
                        }
                        step="any"
                        value={attrValues[a.id] ?? ""}
                        onChange={(e) =>
                          setAttrValues((p) => ({ ...p, [a.id]: e.target.value }))
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
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
        {step < 3 ? (
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
