"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateProductAction } from "./actions";

interface Feature {
  title: string;
  desc: string;
}
interface DatasheetExtra {
  title_accent?: string;
  hero_heading?: string;
  hero_text?: string;
  badge?: { label?: string; desc?: string };
  features?: Feature[];
  why?: string[];
  ideal?: Feature[];
}

export function DatasheetIaguaPanel({
  productId,
  initial,
}: {
  productId: string;
  initial: Record<string, unknown> | null;
}) {
  const ex = (initial ?? {}) as DatasheetExtra;
  const [titleAccent, setTitleAccent] = useState(ex.title_accent ?? "");
  const [heroHeading, setHeroHeading] = useState(ex.hero_heading ?? "");
  const [heroText, setHeroText] = useState(ex.hero_text ?? "");
  const [badgeLabel, setBadgeLabel] = useState(ex.badge?.label ?? "");
  const [badgeDesc, setBadgeDesc] = useState(ex.badge?.desc ?? "");
  const [features, setFeatures] = useState<Feature[]>(
    ex.features?.length ? ex.features : [],
  );
  const [why, setWhy] = useState<string[]>(ex.why?.length ? ex.why : []);
  const [ideal, setIdeal] = useState<Feature[]>(ex.ideal?.length ? ex.ideal : []);
  const [pending, startTransition] = useTransition();

  function save() {
    const extra: DatasheetExtra = {};
    if (titleAccent.trim()) extra.title_accent = titleAccent.trim();
    if (heroHeading.trim()) extra.hero_heading = heroHeading.trim();
    if (heroText.trim()) extra.hero_text = heroText.trim();
    const bl = badgeLabel.trim();
    const bd = badgeDesc.trim();
    if (bl || bd) extra.badge = { ...(bl ? { label: bl } : {}), ...(bd ? { desc: bd } : {}) };
    const feats = features
      .map((f) => ({ title: f.title.trim(), desc: f.desc.trim() }))
      .filter((f) => f.title || f.desc)
      .slice(0, 4);
    if (feats.length) extra.features = feats;
    const whyList = why.map((w) => w.trim()).filter(Boolean).slice(0, 10);
    if (whyList.length) extra.why = whyList;
    const idealList = ideal
      .map((f) => ({ title: f.title.trim(), desc: f.desc.trim() }))
      .filter((f) => f.title || f.desc)
      .slice(0, 6);
    if (idealList.length) extra.ideal = idealList;

    startTransition(async () => {
      const r = await updateProductAction(productId, {
        datasheet_extra: Object.keys(extra).length
          ? (extra as Record<string, unknown>)
          : null,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Guardado", "Contenido de la ficha IAGUA actualizado.");
    });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Estos campos son para la plantilla <strong>IAGUA</strong>. Lo que dejes vacío se
        rellena solo a partir de los datos del producto (atributos destacados, descripción,
        certificaciones). La <strong>página 2</strong> (ventajas) solo aparece si rellenas
        «Por qué elegir» o «Ideal para».
      </p>

      {/* Portada (página 1) */}
      <div className="space-y-3">
        <div className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Portada (página 1)
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Palabra destacada del título</Label>
            <Input
              value={titleAccent}
              onChange={(e) => setTitleAccent(e.target.value)}
              placeholder="Ej.: GOLDEN EYE"
            />
            <p className="text-xs text-muted-foreground">
              La parte del nombre que saldrá en color de acento. Debe estar dentro del nombre del producto.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Titular del hero (caja azul)</Label>
            <Input
              value={heroHeading}
              onChange={(e) => setHeroHeading(e.target.value)}
              placeholder="Ej.: Agua de ósmosis perfecta y equilibrada"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Texto del hero</Label>
          <textarea
            value={heroText}
            onChange={(e) => setHeroText(e.target.value)}
            rows={3}
            placeholder="Párrafo descriptivo que va dentro de la caja azul de la portada."
            className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      </div>

      {/* Tarjetas de características */}
      <ListEditor
        title="Tarjetas de características (máx. 4)"
        addLabel="Añadir característica"
        max={4}
        items={features}
        onAdd={() => setFeatures((f) => [...f, { title: "", desc: "" }])}
        onRemove={(i) => setFeatures((f) => f.filter((_, idx) => idx !== i))}
        render={(it, i) => (
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
            <Input
              value={it.title}
              onChange={(e) =>
                setFeatures((f) => f.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))
              }
              placeholder="Título (ej.: Membrana 800 GPD)"
            />
            <Input
              value={it.desc}
              onChange={(e) =>
                setFeatures((f) => f.map((x, idx) => (idx === i ? { ...x, desc: e.target.value } : x)))
              }
              placeholder="Descripción corta"
            />
          </div>
        )}
      />

      {/* Página 2 — Por qué elegir */}
      <ListEditor
        title="Por qué elegir (página 2 · máx. 10)"
        addLabel="Añadir motivo"
        max={10}
        items={why}
        onAdd={() => setWhy((w) => [...w, ""])}
        onRemove={(i) => setWhy((w) => w.filter((_, idx) => idx !== i))}
        render={(it, i) => (
          <Input
            value={it}
            onChange={(e) => setWhy((w) => w.map((x, idx) => (idx === i ? e.target.value : x)))}
            placeholder="Ej.: Sin garrafas ni botellas. Agua pura ilimitada del grifo."
          />
        )}
      />

      {/* Página 2 — Ideal para */}
      <ListEditor
        title="Ideal para (página 2 · máx. 6)"
        addLabel="Añadir caso de uso"
        max={6}
        items={ideal}
        onAdd={() => setIdeal((d) => [...d, { title: "", desc: "" }])}
        onRemove={(i) => setIdeal((d) => d.filter((_, idx) => idx !== i))}
        render={(it, i) => (
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
            <Input
              value={it.title}
              onChange={(e) =>
                setIdeal((d) => d.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))
              }
              placeholder="Título (ej.: Hogar)"
            />
            <Input
              value={it.desc}
              onChange={(e) =>
                setIdeal((d) => d.map((x, idx) => (idx === i ? { ...x, desc: e.target.value } : x)))
              }
              placeholder="Descripción corta"
            />
          </div>
        )}
      />

      {/* Recuadro inferior (badge) */}
      <div className="space-y-3">
        <div className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Recuadro inferior (badge)
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <div className="space-y-1.5">
            <Label>Texto del sello</Label>
            <Input
              value={badgeLabel}
              onChange={(e) => setBadgeLabel(e.target.value)}
              placeholder="Ej.: 800 GPD"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Descripción del recuadro</Label>
            <Input
              value={badgeDesc}
              onChange={(e) => setBadgeDesc(e.target.value)}
              placeholder="Ej.: Tecnología de ósmosis inversa de alta gama…"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Si lo dejas vacío, se usa la primera certificación del producto.
        </p>
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button onClick={save} disabled={pending} variant="success" className="w-full sm:w-auto">
          Guardar ficha IAGUA
        </Button>
      </div>
    </div>
  );
}

function ListEditor<T>({
  title,
  addLabel,
  max,
  items,
  onAdd,
  onRemove,
  render,
}: {
  title: string;
  addLabel: string;
  max: number;
  items: T[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  render: (item: T, index: number) => ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">Vacío — se rellenará solo si dejas esto sin contenido.</p>
      )}
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">{render(it, i)}</div>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label="Quitar"
              className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </button>
          </div>
        ))}
      </div>
      {items.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={onAdd} className="gap-1">
          <Plus className="h-4 w-4" /> {addLabel}
        </Button>
      )}
    </div>
  );
}
