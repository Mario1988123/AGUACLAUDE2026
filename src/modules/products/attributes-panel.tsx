"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Star } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  setProductAttributeValue,
  deleteProductAttributeValue,
  type ProductAttribute,
  type ProductAttrValue,
} from "./attributes-actions";

interface Props {
  productId: string;
  attributes: ProductAttribute[];
  values: ProductAttrValue[];
}

function valueAsText(v: ProductAttrValue): string {
  switch (v.data_type) {
    case "boolean":
      return v.value_boolean ? "Sí" : "No";
    case "number":
    case "dimension":
      return v.value_number != null ? `${v.value_number}${v.attribute_unit ? " " + v.attribute_unit : ""}` : "—";
    default:
      return v.value_text ?? "—";
  }
}

export function AttributesPanel({ productId, attributes, values }: Props) {
  const [adding, setAdding] = useState(false);
  const featuredCount = values.filter((v) => v.is_featured).length;

  return (
    <div className="space-y-3">
      {values.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Sin atributos asignados a este producto.
        </div>
      )}

      {values.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {featuredCount}/5 atributos destacados (aparecen en ficha técnica).
        </p>
      )}

      {values.map((v) => (
        <ValueRow key={v.id} value={v} productId={productId} />
      ))}

      {adding && (
        <AddValueForm
          productId={productId}
          available={attributes.filter((a) => !values.some((v) => v.attribute_id === a.id))}
          onDone={() => setAdding(false)}
        />
      )}

      {!adding && (
        <Button onClick={() => setAdding(true)} variant="outline" className="w-full">
          <Plus className="h-4 w-4" /> Añadir atributo
        </Button>
      )}
    </div>
  );
}

function ValueRow({ value, productId }: { value: ProductAttrValue; productId: string }) {
  const [pending, startTransition] = useTransition();

  function toggle(field: "is_visible" | "is_featured") {
    startTransition(async () => {
      try {
        await setProductAttributeValue({
          product_id: productId,
          attribute_id: value.attribute_id,
          value_text: value.value_text,
          value_number: value.value_number,
          value_boolean: value.value_boolean,
          is_visible: field === "is_visible" ? !value.is_visible : value.is_visible,
          is_featured: field === "is_featured" ? !value.is_featured : value.is_featured,
          display_order: value.display_order,
        });
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function remove() {
    if (!confirm("¿Quitar este atributo del producto?")) return;
    startTransition(async () => {
      try {
        await deleteProductAttributeValue(value.id, productId);
        notify.success("Quitado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{value.attribute_name}</div>
        <div className="text-xs text-muted-foreground">{valueAsText(value)}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => toggle("is_featured")}
          disabled={pending}
          className={`flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-bold transition-colors ${
            value.is_featured
              ? "bg-warning/15 text-warning"
              : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
          title="Marcar destacado"
        >
          <Star className={`h-3.5 w-3.5 ${value.is_featured ? "fill-current" : ""}`} />
          {value.is_featured ? "Destacado" : "Destacar"}
        </button>
        <button
          type="button"
          onClick={() => toggle("is_visible")}
          disabled={pending}
          className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
            value.is_visible ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
          }`}
        >
          {value.is_visible ? "Visible" : "Oculto"}
        </button>
        <Button variant="ghost" size="icon" onClick={remove} disabled={pending}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function AddValueForm({
  productId,
  available,
  onDone,
}: {
  productId: string;
  available: ProductAttribute[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [attrId, setAttrId] = useState(available[0]?.id ?? "");
  const [value, setValue] = useState("");
  const attr = available.find((a) => a.id === attrId);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!attr) return;
    let payload: Record<string, unknown> = {
      product_id: productId,
      attribute_id: attrId,
      is_visible: true,
      is_featured: false,
    };
    if (attr.data_type === "boolean") {
      payload = { ...payload, value_boolean: value === "true" };
    } else if (attr.data_type === "number" || attr.data_type === "dimension") {
      payload = { ...payload, value_number: Number(value) || 0 };
    } else {
      payload = { ...payload, value_text: value };
    }
    startTransition(async () => {
      try {
        await setProductAttributeValue(payload);
        notify.success("Atributo añadido");
        onDone();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (available.length === 0) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm">
        <p>Ya has asignado todos los atributos disponibles.</p>
        <p className="text-xs text-muted-foreground">
          Crea más atributos en{" "}
          <a href="/configuracion/productos" className="text-primary hover:underline">
            Configuración → Productos
          </a>
          .
        </p>
        <Button variant="outline" size="sm" onClick={onDone}>
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border-2 border-primary bg-primary/5 p-4">
      <div className="space-y-1.5">
        <Label>Atributo</Label>
        <select
          value={attrId}
          onChange={(e) => setAttrId(e.target.value)}
          className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
        >
          {available.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}{a.unit ? ` (${a.unit})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Valor</Label>
        {attr?.data_type === "boolean" ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
          >
            <option value="">—</option>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        ) : (
          <Input
            type={attr?.data_type === "number" || attr?.data_type === "dimension" ? "number" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Añadiendo..." : "Añadir"}
        </Button>
      </div>
    </form>
  );
}
