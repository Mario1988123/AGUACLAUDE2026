"use client";

import { useState, useTransition } from "react";
import { Palette, X, Plus, Save, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
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
      {/* Provider */}
      <div className="space-y-2">
        <Label>Proveedor de generación de imagen</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { v: "none" as const, l: "Ninguno (imagen manual)" },
            { v: "gemini" as const, l: "Google Gemini 2.5 Flash Image" },
          ].map((opt) => (
            <label
              key={opt.v}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border-2 p-3 ${
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
      </div>

      {/* Estilo */}
      <div className="space-y-2">
        <Label>Estilo visual de marca</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {STYLES.map((s) => (
            <label
              key={s.value}
              className={`flex cursor-pointer items-start gap-2 rounded-xl border-2 p-3 ${
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
                className="mt-1"
              />
              <div>
                <div className="text-sm font-bold">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Paleta */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Palette className="h-4 w-4" /> Paleta de marca (hex)
        </Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { v: primary, set: setPrimary, l: "Primario", ph: "#4880FF" },
            { v: secondary, set: setSecondary, l: "Secundario", ph: "#0F8285" },
            { v: accent, set: setAccent, l: "Acento", ph: "#84F2F2" },
          ].map((c, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded border"
                  style={{ background: c.v || "#fff" }}
                />
                <Input
                  value={c.v}
                  onChange={(e) => c.set(e.target.value)}
                  placeholder={c.ph}
                  className="flex-1"
                />
              </div>
              <div className="text-[11px] text-muted-foreground">{c.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Localización y keywords */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Ubicación / ambiente</Label>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Galicia, ambiente costero / Madrid, piso urbano…"
          />
          <p className="text-[11px] text-muted-foreground">
            Una frase corta del contexto donde vive la marca. Se mete en el prompt literal.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Presupuesto mensual de imágenes (€)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={budgetEuros}
            onChange={(e) => setBudgetEuros(e.target.value)}
            placeholder="5"
          />
          <p className="text-[11px] text-muted-foreground">
            Cap de gasto en imágenes IA. ~0,04 € por imagen Gemini. Usadas este mes:{" "}
            <strong>{used}</strong> ({usedEur.toFixed(2)} €). Te quedan{" "}
            <strong>{remainingEur.toFixed(2)} €</strong>.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Keywords visuales (texto libre)</Label>
        <Textarea
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          rows={3}
          placeholder="Casas de piedra, luz fría del norte, tonos azulados, escenas de cocina abierta moderna…"
        />
        <p className="text-[11px] text-muted-foreground">
          Lo que escribas se inyecta TAL CUAL en el prompt como identidad visual.
        </p>
      </div>

      {/* Forbidden + Preferred */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Elementos prohibidos (NO mostrar)</Label>
          <div className="flex gap-2">
            <Input
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
            <Button type="button" variant="outline" size="sm" onClick={addForb}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {forbidden.map((f) => (
              <Badge
                key={f}
                variant="destructive"
                className="cursor-pointer"
                onClick={() =>
                  setForbidden((arr) => arr.filter((x) => x !== f))
                }
              >
                {f} <X className="ml-1 inline h-3 w-3" />
              </Badge>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Elementos preferidos (incluir si encaja)</Label>
          <div className="flex gap-2">
            <Input
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
            <Button type="button" variant="outline" size="sm" onClick={addPref}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {preferred.map((p) => (
              <Badge
                key={p}
                variant="success"
                className="cursor-pointer"
                onClick={() =>
                  setPreferred((arr) => arr.filter((x) => x !== p))
                }
              >
                {p} <X className="ml-1 inline h-3 w-3" />
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" />
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Sparkles className="mb-0.5 inline h-3.5 w-3.5" /> Todo esto se inyecta
        automáticamente en cada prompt enviado a la IA. Cuanto más concreto sea,
        más identitarias serán las imágenes generadas.
      </div>
    </div>
  );
}
