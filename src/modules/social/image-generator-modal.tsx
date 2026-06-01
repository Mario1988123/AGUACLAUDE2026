"use client";

/**
 * Modal grande "Generar imagen con IA" con 4 pestañas. Trae los valores por
 * defecto de social_settings rellenados, pero permite cambiar cualquiera
 * SOLO para esta imagen (overrides) sin tocar la configuración global.
 *
 * Pestañas:
 *   1. Estilo       — estilo visual, paleta, keywords, ubicación
 *   2. Marca        — logo on/off, posición y tamaño + texto marca de agua
 *   3. Productos    — selector multi del catálogo (con miniaturas)
 *   4. Previsualizar — prompt enriquecido + botón Generar
 */

import { useId, useMemo, useState, useTransition, useEffect } from "react";
import {
  Sparkles,
  RefreshCcw,
  Eye,
  RotateCcw,
  Search,
  ImageIcon,
  Palette as PaletteIcon,
  Tag,
  Type,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Badge } from "@/shared/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/shared/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/shared/ui/select";
import { notify } from "@/shared/hooks/use-toast";
import {
  generatePostImageAction,
  previewEnrichedPromptAction,
} from "./image-generation-actions";
import { listProducts } from "@/modules/products/actions";
import { OverlayCanvas } from "./overlay-canvas";
import type {
  ImageOverrides,
  ImageStyle,
  ImageVisualSettings,
  OverlayPosition,
  ResolvedOverlaySettings,
  WatermarkPosition,
} from "./image-types";

const STYLE_OPTIONS: Array<{ value: ImageStyle; label: string }> = [
  { value: "photoreal", label: "Fotografía realista" },
  { value: "editorial", label: "Editorial (revista)" },
  { value: "minimalist", label: "Minimalista" },
  { value: "flat", label: "Vectorial flat" },
  { value: "illustration", label: "Ilustración" },
  { value: "3d", label: "3D / Claymorphism" },
];

const POSITION_OPTIONS: Array<{ value: OverlayPosition; label: string }> = [
  { value: "top-left", label: "Arriba · izquierda" },
  { value: "top-right", label: "Arriba · derecha" },
  { value: "bottom-left", label: "Abajo · izquierda" },
  { value: "bottom-right", label: "Abajo · derecha" },
];

const WATERMARK_POSITION_OPTIONS: Array<{ value: WatermarkPosition; label: string }> = [
  ...POSITION_OPTIONS,
  { value: "bottom-center", label: "Abajo · centro" },
];

interface ProductLite {
  id: string;
  name: string;
  main_image_url: string | null;
  kind: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
  baseImagePrompt: string | null;
  defaults: ImageVisualSettings;
  initialOverrides: ImageOverrides | null;
  initialProductIds: string[];
  capReached: boolean;
  imagesUsed: number;
  monthlyBudgetCents: number;
  hasFiscalLogo: boolean;
  onGenerated: () => void;
}

export function ImageGeneratorModal({
  open,
  onOpenChange,
  postId,
  baseImagePrompt,
  defaults,
  initialOverrides,
  initialProductIds,
  capReached,
  imagesUsed,
  monthlyBudgetCents,
  hasFiscalLogo,
  onGenerated,
}: Props) {
  const reactId = useId();
  const [promptOverride, setPromptOverride] = useState(baseImagePrompt ?? "");
  const [overrides, setOverrides] = useState<ImageOverrides>(
    initialOverrides ?? {},
  );
  const [productIds, setProductIds] = useState<string[]>(initialProductIds);
  const [enrichedPreview, setEnrichedPreview] = useState<string | null>(null);
  const [pendingPreview, startPreview] = useTransition();
  const [pendingGen, startGen] = useTransition();
  const [activeTab, setActiveTab] = useState("estilo");
  // Cuando la imagen se ha generado y queda pendiente de overlay editor:
  const [generated, setGenerated] = useState<{
    image_url: string;
    logo_url: string | null;
    resolved_overlay: ResolvedOverlaySettings;
  } | null>(null);

  // Resetea estado interno cuando se reabre con post distinto.
  useEffect(() => {
    if (open) {
      setPromptOverride(baseImagePrompt ?? "");
      setOverrides(initialOverrides ?? {});
      setProductIds(initialProductIds);
      setEnrichedPreview(null);
      setActiveTab("estilo");
      setGenerated(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, postId]);

  // ── Helpers para mezclar default + override en cada control ──────────────
  function get<K extends keyof ImageOverrides>(
    key: K,
    fallback: ImageOverrides[K],
  ): ImageOverrides[K] {
    const v = overrides[key];
    return v === undefined ? fallback : v;
  }
  function set<K extends keyof ImageOverrides>(
    key: K,
    value: ImageOverrides[K],
  ) {
    setOverrides((o) => ({ ...o, [key]: value }));
  }
  function resetField<K extends keyof ImageOverrides>(key: K) {
    setOverrides((o) => {
      const next = { ...o };
      delete next[key];
      return next;
    });
  }
  function resetAll() {
    setOverrides({});
    setProductIds([]);
    setPromptOverride(baseImagePrompt ?? "");
  }

  const budgetEur = monthlyBudgetCents / 100;
  const usedEur = (imagesUsed * 4) / 100;

  function previewPrompt() {
    startPreview(async () => {
      const r = await previewEnrichedPromptAction(
        postId,
        promptOverride,
        overrides,
        productIds,
      );
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setEnrichedPreview(r.prompt);
      setActiveTab("preview");
    });
  }

  function generate() {
    if (capReached) {
      notify.warning(
        "Tope mensual alcanzado",
        "Sube el presupuesto en /configuracion/rrss o espera al próximo mes.",
      );
      return;
    }
    startGen(async () => {
      const r = await generatePostImageAction(
        postId,
        promptOverride,
        overrides,
        productIds,
      );
      if (!r.ok) {
        notify.error("Error generando imagen", r.error);
        return;
      }
      notify.success(
        "Imagen generada",
        `Coste ${(r.cost_cents / 100).toFixed(2)} € · ${r.images_used} usadas este mes`,
      );
      // Pasamos al editor de overlay (Canvas en cliente).
      setGenerated({
        image_url: r.image_url,
        logo_url: r.logo_url,
        resolved_overlay: r.resolved_overlay,
      });
    });
  }

  function handleEditorSaved() {
    setGenerated(null);
    onOpenChange(false);
    onGenerated();
  }
  function handleEditorSkipped() {
    // El usuario decide NO aplicar overlay. La imagen raw ya está guardada.
    setGenerated(null);
    onOpenChange(false);
    onGenerated();
  }

  // Si hay imagen generada → mostrar SOLO el editor de overlay (canvas).
  if (generated) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              Ajustar logo y texto
            </DialogTitle>
            <DialogDescription className="text-xs">
              Mueve, activa o desactiva el logo y el texto. La vista previa
              muestra exactamente cómo quedará la imagen final.
            </DialogDescription>
          </DialogHeader>
          <OverlayCanvas
            postId={postId}
            imageUrl={generated.image_url}
            logoUrl={generated.logo_url}
            initialOverlay={generated.resolved_overlay}
            onSaved={handleEditorSaved}
            onSkip={handleEditorSkipped}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
            Generar imagen con IA
          </DialogTitle>
          <DialogDescription className="text-xs">
            Los valores por defecto vienen de{" "}
            <code className="rounded bg-muted px-1">/configuracion/rrss</code>.
            Lo que cambies aquí afecta SOLO a esta imagen.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="estilo">
              <PaletteIcon className="mr-1 h-4 w-4" aria-hidden="true" />
              Estilo
            </TabsTrigger>
            <TabsTrigger value="marca">
              <ImageIcon className="mr-1 h-4 w-4" aria-hidden="true" />
              Marca
            </TabsTrigger>
            <TabsTrigger value="productos">
              <Tag className="mr-1 h-4 w-4" aria-hidden="true" />
              Productos
              {productIds.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {productIds.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
              Previsualizar
            </TabsTrigger>
          </TabsList>

          {/* ─────────────────────────── ESTILO ─────────────────────────── */}
          <TabsContent value="estilo" className="space-y-4 pt-4">
            <div className="space-y-2">
              <FieldLabel
                label="Estilo visual"
                isOverridden={overrides.image_style !== undefined}
                onReset={() => resetField("image_style")}
              />
              <Select
                value={get("image_style", defaults.image_style) ?? "editorial"}
                onValueChange={(v) => set("image_style", v as ImageStyle)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <ColorField
                label="Color primario"
                isOverridden={overrides.brand_palette_primary !== undefined}
                value={
                  get("brand_palette_primary", defaults.brand_palette_primary) ?? ""
                }
                onChange={(v) => set("brand_palette_primary", v || null)}
                onReset={() => resetField("brand_palette_primary")}
              />
              <ColorField
                label="Color secundario"
                isOverridden={overrides.brand_palette_secondary !== undefined}
                value={
                  get(
                    "brand_palette_secondary",
                    defaults.brand_palette_secondary,
                  ) ?? ""
                }
                onChange={(v) => set("brand_palette_secondary", v || null)}
                onReset={() => resetField("brand_palette_secondary")}
              />
              <ColorField
                label="Color acento"
                isOverridden={overrides.brand_palette_accent !== undefined}
                value={
                  get("brand_palette_accent", defaults.brand_palette_accent) ?? ""
                }
                onChange={(v) => set("brand_palette_accent", v || null)}
                onReset={() => resetField("brand_palette_accent")}
              />
            </div>

            <div className="space-y-2">
              <FieldLabel
                label="Palabras visuales (estilo de marca)"
                isOverridden={overrides.brand_visual_keywords !== undefined}
                onReset={() => resetField("brand_visual_keywords")}
              />
              <Input
                value={
                  get("brand_visual_keywords", defaults.brand_visual_keywords) ?? ""
                }
                onChange={(e) =>
                  set("brand_visual_keywords", e.target.value || null)
                }
                placeholder="luz fría, casas de piedra, líneas limpias"
              />
            </div>

            <div className="space-y-2">
              <FieldLabel
                label="Ubicación o ambiente"
                isOverridden={overrides.brand_location_hint !== undefined}
                onReset={() => resetField("brand_location_hint")}
              />
              <Input
                value={
                  get("brand_location_hint", defaults.brand_location_hint) ?? ""
                }
                onChange={(e) => set("brand_location_hint", e.target.value || null)}
                placeholder="Galicia costera, cocina moderna española…"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor={`${reactId}-prompt`}
                className="text-xs font-bold uppercase text-muted-foreground"
              >
                Idea visual base (lo que pinta la plantilla)
              </Label>
              <Textarea
                id={`${reactId}-prompt`}
                value={promptOverride}
                onChange={(e) => setPromptOverride(e.target.value)}
                rows={4}
                placeholder="Ej.: grifo cromado con cal en cocina luminosa, vista cenital…"
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Es la <strong>idea de partida</strong>. Se mezcla con el estilo,
                la paleta y todo lo demás antes de mandar a la IA.
              </p>
            </div>
          </TabsContent>

          {/* ─────────────────────────── MARCA ─────────────────────────── */}
          <TabsContent value="marca" className="space-y-4 pt-4">
            <div className="rounded-xl border bg-muted/30 p-3 text-xs">
              <strong>Logo:</strong>{" "}
              {hasFiscalLogo
                ? "se pega TU logo real después de generar (no lo dibuja la IA — sale píxel-perfecto)."
                : "no tienes logo subido. Sube uno en /configuracion/fiscal para activarlo."}
            </div>

            <ToggleRow
              label="Pegar logo en la imagen"
              checked={
                get(
                  "logo_overlay_enabled",
                  defaults.logo_overlay_enabled_default,
                ) ?? true
              }
              onChange={(v) => set("logo_overlay_enabled", v)}
              isOverridden={overrides.logo_overlay_enabled !== undefined}
              onReset={() => resetField("logo_overlay_enabled")}
              disabled={!hasFiscalLogo}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel
                  label="Posición del logo"
                  isOverridden={overrides.logo_position !== undefined}
                  onReset={() => resetField("logo_position")}
                />
                <Select
                  value={
                    get("logo_position", defaults.logo_position_default) ??
                    "bottom-right"
                  }
                  onValueChange={(v) =>
                    set("logo_position", v as OverlayPosition)
                  }
                  disabled={!hasFiscalLogo}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <FieldLabel
                  label={`Tamaño logo (${
                    get("logo_size_pct", defaults.logo_size_pct_default) ?? 12
                  }% del ancho)`}
                  isOverridden={overrides.logo_size_pct !== undefined}
                  onReset={() => resetField("logo_size_pct")}
                />
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={
                    get("logo_size_pct", defaults.logo_size_pct_default) ?? 12
                  }
                  onChange={(e) => set("logo_size_pct", Number(e.target.value))}
                  className="w-full"
                  disabled={!hasFiscalLogo}
                />
              </div>
            </div>

            <hr className="border-border" />

            <ToggleRow
              label="Sobreimpresionar texto"
              icon={<Type className="h-4 w-4" aria-hidden="true" />}
              checked={
                get(
                  "watermark_text_enabled",
                  defaults.watermark_text_enabled_default,
                ) ?? false
              }
              onChange={(v) => set("watermark_text_enabled", v)}
              isOverridden={overrides.watermark_text_enabled !== undefined}
              onReset={() => resetField("watermark_text_enabled")}
            />

            <div className="space-y-2">
              <FieldLabel
                label="Texto a sobreimprimir"
                isOverridden={overrides.watermark_text !== undefined}
                onReset={() => resetField("watermark_text")}
              />
              <Input
                value={get("watermark_text", defaults.watermark_text_default) ?? ""}
                onChange={(e) => set("watermark_text", e.target.value || null)}
                placeholder="Ej.: AguaPura Canarias · 900 123 456"
                maxLength={80}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel
                  label="Posición texto"
                  isOverridden={overrides.watermark_text_position !== undefined}
                  onReset={() => resetField("watermark_text_position")}
                />
                <Select
                  value={
                    get(
                      "watermark_text_position",
                      defaults.watermark_text_position_default,
                    ) ?? "bottom-center"
                  }
                  onValueChange={(v) =>
                    set("watermark_text_position", v as WatermarkPosition)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WATERMARK_POSITION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <ColorField
                label="Color texto"
                isOverridden={overrides.watermark_text_color !== undefined}
                value={
                  get(
                    "watermark_text_color",
                    defaults.watermark_text_color_default,
                  ) ?? "#FFFFFF"
                }
                onChange={(v) => set("watermark_text_color", v || null)}
                onReset={() => resetField("watermark_text_color")}
              />
            </div>
          </TabsContent>

          {/* ─────────────────────────── PRODUCTOS ─────────────────────── */}
          <TabsContent value="productos" className="space-y-3 pt-4">
            <ProductPicker
              selectedIds={productIds}
              onChange={setProductIds}
            />
          </TabsContent>

          {/* ─────────────────────────── PREVIEW ─────────────────────────── */}
          <TabsContent value="preview" className="space-y-3 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={previewPrompt}
                loading={pendingPreview}
                loadingText="Construyendo…"
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                {enrichedPreview ? "Recalcular prompt" : "Calcular prompt enriquecido"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Verás el prompt EXACTO que se enviará a Gemini, sin gastar nada.
              </span>
            </div>
            {enrichedPreview ? (
              <pre className="max-h-72 overflow-auto rounded-xl border bg-muted/40 p-3 text-[11px] font-mono whitespace-pre-wrap">
                {enrichedPreview}
              </pre>
            ) : (
              <div className="rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
                Pulsa &quot;Calcular prompt enriquecido&quot; para ver lo que se
                enviará a la IA.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col items-stretch gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Consumo: <strong className="tabular-nums">{imagesUsed}</strong>{" "}
              imágenes (<span className="tabular-nums">{usedEur.toFixed(2)} €</span>) /{" "}
              <span className="tabular-nums">{budgetEur.toFixed(2)} €</span>
            </span>
            {capReached && (
              <span className="font-bold text-rose-700">Tope alcanzado</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetAll}
              title="Quita todos los overrides y vuelve a los valores por defecto de /configuracion/rrss"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
            <Button
              type="button"
              onClick={generate}
              loading={pendingGen}
              loadingText="Generando…"
              disabled={capReached}
            >
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Generar imagen
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────────────

function FieldLabel({
  label,
  isOverridden,
  onReset,
}: {
  label: string;
  isOverridden: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs font-bold uppercase text-muted-foreground">
        {label}
      </Label>
      {isOverridden && (
        <button
          type="button"
          onClick={onReset}
          className="text-[10px] uppercase text-primary underline"
          title="Volver al valor por defecto de /configuracion/rrss"
        >
          ← Default
        </button>
      )}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  isOverridden,
  onReset,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isOverridden: boolean;
  onReset: () => void;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel label={label} isOverridden={isOverridden} onReset={onReset} />
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded border bg-background"
          aria-label={label}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#4880FF"
          className="font-mono text-xs"
          maxLength={7}
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  icon,
  checked,
  onChange,
  isOverridden,
  onReset,
  disabled,
}: {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  isOverridden: boolean;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 text-sm">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {isOverridden && (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] uppercase text-primary underline"
            title="Volver al default"
          >
            ← Default
          </button>
        )}
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function ProductPicker({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductLite[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listProducts({ q: q.trim() || undefined, active_only: true })
      .then((rows) => {
        if (!alive) return;
        const lite: ProductLite[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          main_image_url: r.main_image_url ?? null,
          kind: r.kind,
        }));
        setItems(lite);
      })
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q]);

  const selectedItems = useMemo(
    () => (items ?? []).filter((p) => selectedIds.includes(p.id)),
    [items, selectedIds],
  );

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      if (selectedIds.length >= 4) {
        notify.warning(
          "Máximo 4 productos",
          "Para mantener la imagen limpia, limita la selección a 4 productos.",
        );
        return;
      }
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-muted/30 p-3 text-xs">
        Marca hasta 4 productos. Su nombre y descripción se inyectan en el
        prompt, y si tienen foto subida, esa foto se envía a Gemini como
        <strong> referencia visual</strong> para que respete el diseño real.
      </div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o referencia…"
          className="pl-8"
        />
      </div>

      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedItems.map((p) => (
            <Badge
              key={p.id}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => toggle(p.id)}
              title="Quitar"
            >
              {p.name} ✕
            </Badge>
          ))}
        </div>
      )}

      <div className="max-h-64 overflow-y-auto rounded-xl border">
        {loading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : !items || items.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Sin productos.
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((p) => {
              const checked = selectedIds.includes(p.id);
              return (
                <li
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-3 p-2 hover:bg-muted/40 ${
                    checked ? "bg-primary/5" : ""
                  }`}
                  onClick={() => toggle(p.id)}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(p.id)}
                    className="cursor-pointer"
                    aria-label={`Seleccionar ${p.name}`}
                  />
                  {p.main_image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={p.main_image_url}
                      alt=""
                      className="h-10 w-10 rounded border object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded border bg-muted text-muted-foreground">
                      <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-[10px] uppercase text-muted-foreground">
                      {p.kind}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
