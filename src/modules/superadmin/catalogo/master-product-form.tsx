"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { PRODUCT_KIND, KIND_LABEL } from "@/modules/products/schemas";
import {
  createCatalogProductSafeAction,
  updateCatalogProductSafeAction,
  setCatalogProductAttributesSafeAction,
  listGlobalAttributesForCategory,
  createGlobalAttributeForCategoryAction,
  type GlobalCategoryOption,
  type GlobalAttributeForm,
  type CatalogProductDetail,
} from "./master-products-actions";

interface ManufacturerOption {
  id: string;
  name: string;
}

/**
 * Formulario del producto MAESTRO (superadmin). Mismos campos que el alta
 * normal MENOS precio y stock. La referencia del proveedor es la llave: en
 * edición se muestra bloqueada.
 */
export function MasterProductForm({
  mode,
  manufacturers,
  categories,
  product,
}: {
  mode: "create" | "edit";
  manufacturers: ManufacturerOption[];
  categories: GlobalCategoryOption[];
  product?: CatalogProductDetail;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [manufacturerId, setManufacturerId] = useState(product?.manufacturer_id ?? "");
  const [supplierRef, setSupplierRef] = useState(product?.supplier_reference ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [kind, setKind] = useState(product?.kind ?? "equipment");
  const [categoryKey, setCategoryKey] = useState(product?.category_global_key ?? "");
  const [shortDesc, setShortDesc] = useState(product?.short_description ?? "");
  const [longDesc, setLongDesc] = useState(product?.long_description ?? "");
  const [width, setWidth] = useState(product?.dim_width_mm?.toString() ?? "");
  const [height, setHeight] = useState(product?.dim_height_mm?.toString() ?? "");
  const [depth, setDepth] = useState(product?.dim_depth_mm?.toString() ?? "");
  const [weight, setWeight] = useState(product?.weight_grams?.toString() ?? "");

  const [attrs, setAttrs] = useState<GlobalAttributeForm[]>([]);
  const [attrLoading, setAttrLoading] = useState(false);
  // "Añadir atributo nuevo" (crea atributo global + lo engancha a la categoría)
  const [showAddAttr, setShowAddAttr] = useState(false);
  const [newAttrName, setNewAttrName] = useState("");
  const [newAttrType, setNewAttrType] = useState("text");
  const [newAttrUnit, setNewAttrUnit] = useState("");
  const [addingAttr, startAddAttr] = useTransition();
  const [attrValues, setAttrValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const a of product?.attributes ?? []) {
      init[a.attribute_global_key] =
        a.value_boolean != null
          ? a.value_boolean
            ? "true"
            : "false"
          : a.value_number != null
            ? String(a.value_number)
            : a.value_text ?? "";
    }
    return init;
  });

  // Cargar atributos globales aplicables a la categoría elegida.
  useEffect(() => {
    if (!categoryKey) {
      setAttrs([]);
      return;
    }
    let cancelled = false;
    setAttrLoading(true);
    listGlobalAttributesForCategory(categoryKey)
      .then((rows) => {
        if (cancelled) return;
        setAttrs(rows);
        setAttrValues((prev) => {
          const next: Record<string, string> = {};
          for (const a of rows) next[a.key] = prev[a.key] ?? "";
          return next;
        });
      })
      .catch(() => setAttrs([]))
      .finally(() => {
        if (!cancelled) setAttrLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryKey]);

  function buildAttrPayload() {
    return attrs
      .map((a) => {
        const raw = (attrValues[a.key] ?? "").trim();
        if (raw === "") return null;
        if (a.data_type === "boolean")
          return { attribute_global_key: a.key, value_boolean: raw === "true" };
        if (a.data_type === "number" || a.data_type === "dimension") {
          const n = Number(raw.replace(",", "."));
          if (!Number.isFinite(n)) return null;
          return { attribute_global_key: a.key, value_number: n };
        }
        return { attribute_global_key: a.key, value_text: raw };
      })
      .filter(Boolean) as Array<{
      attribute_global_key: string;
      value_text?: string | null;
      value_number?: number | null;
      value_boolean?: boolean | null;
    }>;
  }

  function intOrNull(v: string): number | null {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function submit() {
    if (!name.trim()) {
      notify.warning("El nombre es obligatorio");
      return;
    }
    if (!supplierRef.trim()) {
      notify.warning("La referencia del proveedor es obligatoria (es la llave)");
      return;
    }
    const basics = {
      manufacturer_id: manufacturerId || null,
      supplier_reference: supplierRef.trim(),
      name: name.trim(),
      kind,
      category_global_key: categoryKey || null,
      short_description: shortDesc || null,
      long_description: longDesc || null,
      dim_width_mm: intOrNull(width),
      dim_height_mm: intOrNull(height),
      dim_depth_mm: intOrNull(depth),
      weight_grams: intOrNull(weight),
    };
    startTransition(async () => {
      if (mode === "create") {
        const r = await createCatalogProductSafeAction(basics);
        if (!r.ok) {
          notify.error("No se pudo crear", r.error);
          return;
        }
        const attrPayload = buildAttrPayload();
        if (attrPayload.length > 0) {
          await setCatalogProductAttributesSafeAction(r.id, attrPayload);
        }
        notify.success("Producto maestro creado", "Ahora añade fotos y documentación.");
        router.push(`/superadmin/catalogo/productos/${r.id}` as never);
      } else if (product) {
        const r = await updateCatalogProductSafeAction(product.id, basics);
        if (!r.ok) {
          notify.error("No se pudo guardar", r.error);
          return;
        }
        await setCatalogProductAttributesSafeAction(product.id, buildAttrPayload());
        notify.success("Cambios guardados");
        router.refresh();
      }
    });
  }

  function addNewAttribute() {
    if (!categoryKey) {
      notify.warning("Elige una categoría primero");
      return;
    }
    if (!newAttrName.trim()) {
      notify.warning("Escribe el nombre del atributo");
      return;
    }
    startAddAttr(async () => {
      try {
        const r = await createGlobalAttributeForCategoryAction({
          categoryKey,
          name: newAttrName.trim(),
          dataType: newAttrType,
          unit: newAttrUnit.trim() || undefined,
        });
        if (!r.ok) {
          notify.error("No se pudo añadir", r.error);
          return;
        }
        setAttrs((prev) =>
          prev.some((a) => a.key === r.attribute.key) ? prev : [...prev, r.attribute],
        );
        setAttrValues((prev) => ({ ...prev, [r.attribute.key]: "" }));
        setNewAttrName("");
        setNewAttrUnit("");
        setNewAttrType("text");
        setShowAddAttr(false);
        notify.success("Atributo añadido a la categoría");
      } catch (e) {
        notify.error("Error", e instanceof Error ? e.message : "No se pudo añadir");
      }
    });
  }

  return (
    <div className="space-y-5 rounded-2xl border bg-card p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Fabricante</Label>
          <select
            value={manufacturerId}
            onChange={(e) => setManufacturerId(e.target.value)}
            className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
          >
            <option value="">— Sin fabricante —</option>
            {manufacturers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Referencia del proveedor * (llave)</Label>
          <Input
            value={supplierRef}
            onChange={(e) => setSupplierRef(e.target.value)}
            disabled={mode === "edit"}
            placeholder="Ej. OSM-500-PRO"
          />
          {mode === "edit" && (
            <p className="text-[11px] text-muted-foreground">
              No se puede cambiar: es el enganche con las empresas.
            </p>
          )}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Nombre *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
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
            value={categoryKey}
            onChange={(e) => setCategoryKey(e.target.value)}
            className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
          >
            <option value="">— Sin categoría —</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name_es}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Descripción corta</Label>
          <Input value={shortDesc} onChange={(e) => setShortDesc(e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Descripción larga</Label>
          <textarea
            value={longDesc}
            onChange={(e) => setLongDesc(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Dimensiones (mm) y peso (g) — opcional
        </Label>
        <div className="grid gap-3 sm:grid-cols-4">
          <Input placeholder="Ancho" type="number" min={0} value={width} onChange={(e) => setWidth(e.target.value)} />
          <Input placeholder="Alto" type="number" min={0} value={height} onChange={(e) => setHeight(e.target.value)} />
          <Input placeholder="Fondo" type="number" min={0} value={depth} onChange={(e) => setDepth(e.target.value)} />
          <Input placeholder="Peso (g)" type="number" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>
      </div>

      {/* Atributos de la categoría (globales) */}
      <div className="space-y-3 border-t pt-4">
        <Label className="text-sm font-bold">Atributos de la categoría</Label>
        {!categoryKey && (
          <p className="text-sm text-muted-foreground">
            Elige una categoría para ver sus atributos.
          </p>
        )}
        {categoryKey && attrLoading && (
          <p className="text-sm text-muted-foreground">Cargando atributos…</p>
        )}
        {categoryKey && !attrLoading && attrs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Esta categoría no tiene atributos definidos en el catálogo global.
          </p>
        )}
        {attrs.map((a) => (
          <div key={a.key} className="grid gap-2 sm:grid-cols-3 sm:items-center">
            <Label className="sm:col-span-1">
              {a.name_es}
              {a.unit ? ` (${a.unit})` : ""}
              {a.is_required && <span className="text-destructive"> *</span>}
            </Label>
            <div className="sm:col-span-2">
              {a.data_type === "boolean" ? (
                <select
                  value={attrValues[a.key] ?? ""}
                  onChange={(e) => setAttrValues((p) => ({ ...p, [a.key]: e.target.value }))}
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                >
                  <option value="">—</option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              ) : a.data_type === "enum" && a.enum_values?.length ? (
                <select
                  value={attrValues[a.key] ?? ""}
                  onChange={(e) => setAttrValues((p) => ({ ...p, [a.key]: e.target.value }))}
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
                  type={a.data_type === "number" || a.data_type === "dimension" ? "number" : "text"}
                  step="any"
                  value={attrValues[a.key] ?? ""}
                  onChange={(e) => setAttrValues((p) => ({ ...p, [a.key]: e.target.value }))}
                />
              )}
            </div>
          </div>
        ))}

        {categoryKey &&
          !attrLoading &&
          (showAddAttr ? (
            <div className="space-y-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                <Input
                  placeholder="Nombre del atributo (ej. Caudal)"
                  value={newAttrName}
                  onChange={(e) => setNewAttrName(e.target.value)}
                />
                <select
                  value={newAttrType}
                  onChange={(e) => setNewAttrType(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                >
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                  <option value="boolean">Sí/No</option>
                </select>
              </div>
              {newAttrType === "number" && (
                <Input
                  placeholder="Unidad (ej. L/min, bar, kg)"
                  value={newAttrUnit}
                  onChange={(e) => setNewAttrUnit(e.target.value)}
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                Se añade a la categoría: aparecerá en todos los productos de esta categoría.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddAttr(false)}
                  disabled={addingAttr}
                >
                  Cancelar
                </Button>
                <Button variant="success" size="sm" onClick={addNewAttribute} disabled={addingAttr}>
                  {addingAttr ? "Añadiendo…" : "Añadir"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAddAttr(true)}>
              <Plus className="h-4 w-4" /> Añadir atributo
            </Button>
          ))}
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button onClick={submit} disabled={pending} variant="success" size="lg">
          <Save className="h-4 w-4" />
          {pending ? "Guardando…" : mode === "create" ? "Crear producto" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}
