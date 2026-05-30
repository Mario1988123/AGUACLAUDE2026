"use client";

import { useId, useState, useTransition } from "react";
import { Palette, X, Plus, Save, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { notify } from "@/shared/hooks/use-toast";
import { saveSocialImageSettingsAction } from "./image-settings-actions";
import type { ImageProvider, ImageStyle, ImageVisualSettings } from "./image-types";

const STYLES: Array<{ value: ImageStyle; label: string; desc: string }> = [
  { value: "editorial", label: "Editorial", desc: "Limpio tipo revista. Composición minimal, iluminación natural." },
  { value: "photoreal", label: "Fotorrealista", desc: "Foto profesional realista con luz cinematográfica." },
  { value: "flat", label: "Flat", desc: "Vectorial moderno, formas geométricas, sin sombras complejas." },
  { value: "illustration", label: "Ilustración", desc: "Dibujada con sombras suaves, tipo libro premium." },
  { value: "3d", label: "3D claymorphism", desc: "Render 3D estilo isométrico, materiales suaves." },
  { value: "minimalist", label: "Minimalista", desc: "Un solo sujeto, mucho espacio negativo." },
];

export function SocialImageSettingsForm({
  initial,
}: {
  initial: ImageVisualSettings;
}) {
  // IDs únicos para asociar labels con inputs (accesibilidad + móvil con
  // lectores de pantalla).
  const reactId = useId();
  const ids = {
    primary: `${reactId}-primary`,
    secondary: `${reactId}-secondary`,
    accent: `${reactId}-accent`,
    location: `${reactId}-location`,
    budget: `${reactId}-budget`,
    keywords: `${reactId}-keywords`,
    forbidden: `${reactId}-forbidden`,
    preferred: `${reactId}-preferred`,
  };
  const [provider, setProvider] = useState<ImageProvider>(initial.image_provider);
  const [style, setStyle] = useState<ImageStyle>(
    (initial.image_style ?? "editorial") as ImageStyle,
  );
  const [primary, setPrimary] = useState(initial.brand_palette_primary ?? "");
  const [secondary, setSecondary] = useState(initial.brand_palette_secondary ?? "");
  const [accent, setAccent] = useState(initial.brand_palette_accent ?? "");
  const [keywords, setKeywords] = useState(initial.brand_visual_keywords ?? "");
  const [location, setLocation] = useState(initial.brand_location_hint ?? "");
  const [forbidden, setForbidden] = useState<string[]>(
    initial.forbidden_visual_elements ?? [],
  );
  const [preferred, setPreferred] = useState<string[]>(
    initial.preferred_visual_elements ?? [],
  );
  const [budgetEuros, setBudgetEuros] = useState(
    ((initial.monthly_image_budget_cents ?? 500) / 100).toString(),
  );
  const [newForb, setNewForb] = useState("");
  const [newPref, setNewPref] = useState("");
  const [pending, startTransition] = useTransition();

  function addForb() {
    const v = newForb.trim();
    if (!v) return;
    setForbidden((arr) => Array.from(new Set([...arr, v])));
    setNewForb("");
  }
  function addPref() {
    const v = newPref.trim();
    if (!v) return;
    setPreferred((arr) => Array.from(new Set([...arr, v])));
    setNewPref("");
  }

  function save() {
    startTransition(async () => {
      const budgetCents = Math.round(
        (parseFloat(budgetEuros.replace(",", ".")) || 0) * 100,
      );
      const r = await saveSocialImageSettingsAction({
        image_provider: provider,
        image_style: style,
        brand_palette_primary: primary || null,
        brand_palette_secondary: secondary || null,
        brand_palette_accent: accent || null,
        brand_visual_keywords: keywords || null,
        brand_location_hint: location || null,
        forbidden_visual_elements: forbidden,
        preferred_visual_elements: preferred,
        monthly_image_budget_cents: budgetCents,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Guardado");
    });
  }

  const used = initial.images_used_this_month ?? 0;
  const budget = initial.monthly_image_budget_cents ?? 500;
  const usedEur = (used * 4) / 100;
  const remainingEur = (budget - used * 4) / 100;

  return (
    <div className="space-y-6">
      {/* Provider — fieldset/legend para semántica de grupo de radios */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">
          Proveedor de generación de imagen
        </legend>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
          {[
            { v: "none" as const, l: "Ninguno (imagen manual)" },
            { v: "gemini" as const, l: "Google Gemini 2.5 Flash Image" },
          ].map((opt) => (
            <label
              key={opt.v}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border-2 p-3 transition-colors ${
                provider === opt.v
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value={opt.v}
                checked={provider === opt.v}
                onChange={(e) => setProvider(e.target.value as ImageProvider)}
                className="text-primary"
              />
              <span className="text-sm font-medium">{opt.l}</span>
            </label>
          ))}
        </div>
        {provider === "gemini" && (
          <p className="text-xs text-muted-foreground">
            Necesita la env var <code className="rounded bg-muted px-1">GOOGLE_GENAI_API_KEY</code> en
            Vercel. Si no está, el botón de generar muestra error claro al admin.
          </p>
        )}
      </fieldset>

      {/* Estilo — fieldset, grid 1→2→3 cols, eligible "card" táctil */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">
          Estilo visual de marca
        </legend>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {STYLES.map((s) => (
            <label
              key={s.value}
              className={`flex cursor-pointer items-start gap-2 rounded-xl border-2 p-3 transition-colors ${
                style === s.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name="style"
                value={s.value}
                checked={style === s.value}
                onChange={(e) => setStyle(e.target.value as ImageStyle)}
                className="mt-1 text-primary"
              />
              <div className="min-w-0">
                <div className="text-sm font-bold">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Paleta — label asociado por htmlFor + grid 1 col móvil */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Palette className="h-4 w-4" aria-hidden="true" /> Paleta de marca (hex)
        </div>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          {[
            { id: ids.primary, v: primary, set: setPrimary, l: "Primario", ph: "#4880FF" },
            { id: ids.secondary, v: secondary, set: setSecondary, l: "Secundario", ph: "#0F8285" },
            { id: ids.accent, v: accent, set: setAccent, l: "Acento", ph: "#84F2F2" },
          ].map((c) => (
            <div key={c.id} className="space-y-1.5">
              <Label htmlFor={c.id} className="text-xs">
                {c.l}
              </Label>
              <div className="flex items-center gap-2">
                <div
                  aria-hidden="true"
                  className="h-9 w-9 shrink-0 rounded-md border border-border shadow-sm"
                  style={{ background: c.v || "#fff" }}
                  data-inline
                />
                <Input
                  id={c.id}
                  value={c.v}
                  onChange={(e) => c.set(e.target.value)}
                  placeholder={c.ph}
                  aria-label={`Color ${c.l.toLowerCase()} en hexadecimal`}
                  className="flex-1"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Localización y keywords */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={ids.location}>Ubicación / ambiente</Label>
          <Input
            id={ids.location}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Galicia, ambiente costero / Madrid, piso urbano…"
            aria-describedby={`${ids.location}-help`}
          />
          <p id={`${ids.location}-help`} className="text-[11px] text-muted-foreground">
            Una frase corta del contexto donde vive la marca. Se mete en el prompt literal.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.budget}>Presupuesto mensual de imágenes (€)</Label>
          <Input
            id={ids.budget}
            type="text"
            inputMode="decimal"
            value={budgetEuros}
            onChange={(e) => setBudgetEuros(e.target.value)}
            placeholder="5"
            aria-describedby={`${ids.budget}-help`}
          />
          <p id={`${ids.budget}-help`} className="text-[11px] text-muted-foreground">
            Cap de gasto en imágenes IA. ~0,04 € por imagen Gemini. Usadas este mes:{" "}
            <strong>{used}</strong> ({usedEur.toFixed(2)} €). Te quedan{" "}
            <strong>{remainingEur.toFixed(2)} €</strong>.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.keywords}>Keywords visuales (texto libre)</Label>
        <Textarea
          id={ids.keywords}
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          rows={3}
          placeholder="Casas de piedra, luz fría del norte, tonos azulados, escenas de cocina abierta moderna…"
          aria-describedby={`${ids.keywords}-help`}
        />
        <p id={`${ids.keywords}-help`} className="text-[11px] text-muted-foreground">
          Lo que escribas se inyecta TAL CUAL en el prompt como identidad visual.
        </p>
      </div>

      {/* Forbidden + Preferred — chips como <button> con aria-label correcto */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={ids.forbidden}>Elementos prohibidos (NO mostrar)</Label>
          <div className="flex gap-2">
            <Input
              id={ids.forbidden}
              value={newForb}
              onChange={(e) => setNewForb(e.target.value)}
              placeholder="caras de personas, marcas competidoras…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addForb();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addForb}
              aria-label="Añadir elemento prohibido"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {forbidden.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Elementos prohibidos">
              {forbidden.map((f) => (
                <li key={f}>
                  <button
                    type="button"
                    onClick={() => setForbidden((arr) => arr.filter((x) => x !== f))}
                    aria-label={`Quitar prohibido: ${f}`}
                    data-compact
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/20"
                  >
                    {f} <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.preferred}>Elementos preferidos (incluir si encaja)</Label>
          <div className="flex gap-2">
            <Input
              id={ids.preferred}
              value={newPref}
              onChange={(e) => setNewPref(e.target.value)}
              placeholder="furgoneta de la empresa, plantas naturales…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPref();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addPref}
              aria-label="Añadir elemento preferido"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {preferred.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Elementos preferidos">
              {preferred.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => setPreferred((arr) => arr.filter((x) => x !== p))}
                    aria-label={`Quitar preferido: ${p}`}
                    data-compact
                    className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-1 text-xs font-medium text-success hover:bg-success/20"
                  >
                    {p} <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
        <Button
          onClick={save}
          loading={pending}
          loadingText="Guardando…"
          variant="success"
          className="w-full sm:w-auto"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Guardar
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Sparkles className="mb-0.5 inline h-3.5 w-3.5" aria-hidden="true" /> Todo esto se
        inyecta automáticamente en cada prompt enviado a la IA. Cuanto más concreto
        sea, más identitarias serán las imágenes generadas.
      </div>
    </div>
  );
}
