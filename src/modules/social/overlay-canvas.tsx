"use client";

/**
 * OverlayCanvas — Editor de capas para imagen RRSS.
 *
 * Características:
 *  - Imagen IA grande en la parte superior (preview real WYSIWYG)
 *  - Capa de LOGO independiente (arrastrable + tamaño + esquina)
 *  - Capas de TEXTO múltiples (cada una con su contenido, fuente, color,
 *    tamaño, peso, panel de fondo opcional, posición arrastrable)
 *  - Drag & drop sobre el canvas con ratón y dedo (touch)
 *  - 6 tipografías Google Fonts cargadas dinámicamente
 *  - Botón "Añadir texto" / "Eliminar capa"
 *  - Export final a PNG → server action que reemplaza la imagen en Storage
 *
 * Reemplaza el overlay server-side con sharp+Pango (que devolvía cuadrados □
 * en Vercel/Lambda por falta de fuentes).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Save,
  X,
  Type,
  ImageOff,
  Trash2,
  Plus,
  Layers as LayersIcon,
  Sliders,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/shared/ui/select";
import { notify } from "@/shared/hooks/use-toast";
import { saveFinalPostImageAction } from "./image-generation-actions";
import type { ResolvedOverlaySettings } from "./image-types";

interface Props {
  postId: string;
  imageUrl: string;
  /** Logo ya como dataURL PNG (el server lo convierte). null si no hay. */
  logoUrl: string | null;
  initialOverlay: ResolvedOverlaySettings;
  onSaved: () => void;
  onSkip: () => void;
}

/** Fuentes que se cargan en Google Fonts y se pueden usar en canvas. */
const FONT_OPTIONS: Array<{ value: string; label: string; gfont?: string }> = [
  { value: "Nunito Sans", label: "Nunito Sans (CRM)" },
  { value: "Inter", label: "Inter (moderno)", gfont: "Inter:wght@400;700;900" },
  {
    value: "Montserrat",
    label: "Montserrat (corporativo)",
    gfont: "Montserrat:wght@400;700;900",
  },
  {
    value: "Playfair Display",
    label: "Playfair Display (serif)",
    gfont: "Playfair+Display:wght@400;700;900",
  },
  {
    value: "Bebas Neue",
    label: "Bebas Neue (impacto)",
    gfont: "Bebas+Neue",
  },
  {
    value: "Pacifico",
    label: "Pacifico (manuscrita)",
    gfont: "Pacifico",
  },
];

interface TextLayer {
  id: string;
  text: string;
  /** Coordenadas RELATIVAS al canvas (0-1). Independientes del tamaño real. */
  x: number;
  y: number;
  fontFamily: string;
  /** Tamaño en % del ancho del canvas (3 = ~30px en 1024). */
  fontSizePct: number;
  color: string;
  bold: boolean;
  italic: boolean;
  /** Panel de fondo semi-transparente para legibilidad. */
  hasPanel: boolean;
}

interface LogoState {
  enabled: boolean;
  /** Coordenadas centro del logo, relativas al canvas (0-1). */
  x: number;
  y: number;
  /** Tamaño del logo en % del ancho. */
  sizePct: number;
}

// ─────────────────────────────────────────────────────────────────────────────

export function OverlayCanvas({
  postId,
  imageUrl,
  logoUrl,
  initialOverlay,
  onSaved,
  onSkip,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [pendingSave, startSave] = useTransition();
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Inicializar capa de texto desde el initialOverlay si está activo.
  const [layers, setLayers] = useState<TextLayer[]>(() => {
    if (
      initialOverlay.watermark_text_enabled &&
      initialOverlay.watermark_text &&
      initialOverlay.watermark_text.trim().length > 0
    ) {
      const initialPos = positionFromOverlayPos(
        initialOverlay.watermark_text_position,
      );
      return [
        {
          id: cryptoRandomId(),
          text: initialOverlay.watermark_text.trim(),
          x: initialPos.x,
          y: initialPos.y,
          fontFamily: "Nunito Sans",
          fontSizePct: 3.5,
          color: initialOverlay.watermark_text_color || "#FFFFFF",
          bold: true,
          italic: false,
          hasPanel: true,
        },
      ];
    }
    return [];
  });
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    layers[0]?.id ?? null,
  );
  const [logo, setLogo] = useState<LogoState>(() => {
    const p = positionFromOverlayPos(initialOverlay.logo_position);
    return {
      enabled: initialOverlay.logo_enabled && !!logoUrl,
      x: p.x,
      y: p.y,
      sizePct: initialOverlay.logo_size_pct || 12,
    };
  });
  const [logoSelected, setLogoSelected] = useState(false);
  const [activeTab, setActiveTab] = useState<"capas" | "estilo">("capas");

  // ── Cargar Google Fonts dinámicamente ──────────────────────────────────────
  useEffect(() => {
    // Inyectar <link> de Google Fonts si no existe ya.
    const families = FONT_OPTIONS.map((f) => f.gfont)
      .filter((g): g is string => !!g)
      .join("&family=");
    const id = "hidromanager-overlay-fonts";
    if (!document.getElementById(id) && families) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
      document.head.appendChild(link);
    }
    // Esperar a que todas las fuentes estén disponibles.
    (async () => {
      try {
        const promises = FONT_OPTIONS.map((f) =>
          document.fonts.load(`bold 48px "${f.value}"`),
        );
        await Promise.all(promises);
        await document.fonts.ready;
      } catch {
        /* No bloquear si una fuente falla */
      }
      setFontsLoaded(true);
    })();
  }, []);

  // ── Cargar imagen base y logo ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadImg(src: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        // dataURL no necesita crossOrigin. URL normal sí.
        if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    async function loadImgWithFallback(src: string): Promise<HTMLImageElement> {
      try {
        return await loadImg(src);
      } catch {
        // Fallback: fetch + objectURL (algunos CORS no funcionan vía Image).
        const r = await fetch(src);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        try {
          return await loadImg(url);
        } finally {
          // No revoco la URL — la usa la Image hasta el final del componente.
        }
      }
    }

    (async () => {
      try {
        const base = await loadImgWithFallback(imageUrl);
        if (cancelled) return;
        baseImgRef.current = base;

        if (logoUrl) {
          try {
            const logoImg = await loadImg(logoUrl);
            if (cancelled) return;
            logoImgRef.current = logoImg;
          } catch {
            logoImgRef.current = null;
          }
        }
        setReady(true);
      } catch {
        notify.error(
          "No se pudo cargar la imagen",
          "Inténtalo de nuevo o regenera la imagen.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [imageUrl, logoUrl]);

  // ── Repintar canvas ────────────────────────────────────────────────────────
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseImgRef.current;
    if (!canvas || !base) return;
    const W = base.naturalWidth || 1024;
    const H = base.naturalHeight || 1024;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0, W, H);

    // Logo
    if (logo.enabled && logoImgRef.current) {
      drawLogo(ctx, logoImgRef.current, W, H, logo);
    }

    // Capas de texto
    for (const layer of layers) {
      drawTextLayer(ctx, W, H, layer);
    }
  }, [layers, logo]);

  useEffect(() => {
    if (ready && fontsLoaded) repaint();
  }, [ready, fontsLoaded, repaint]);

  // ── Drag & drop sobre el canvas ────────────────────────────────────────────
  const dragRef = useRef<{
    type: "layer" | "logo" | null;
    layerId: string | null;
    startCanvasX: number;
    startCanvasY: number;
    startElemX: number;
    startElemY: number;
  }>({
    type: null,
    layerId: null,
    startCanvasX: 0,
    startCanvasY: 0,
    startElemX: 0,
    startElemY: 0,
  });

  function eventToCanvasCoords(
    clientX: number,
    clientY: number,
  ): { cx: number; cy: number; W: number; H: number } | null {
    const canvas = canvasRef.current;
    const base = baseImgRef.current;
    if (!canvas || !base) return null;
    const rect = canvas.getBoundingClientRect();
    const W = base.naturalWidth || 1024;
    const H = base.naturalHeight || 1024;
    const cx = ((clientX - rect.left) / rect.width) * W;
    const cy = ((clientY - rect.top) / rect.height) * H;
    return { cx, cy, W, H };
  }

  function hitTest(
    cx: number,
    cy: number,
    W: number,
    H: number,
  ): { type: "layer"; id: string } | { type: "logo" } | null {
    // Hit test capas TEXTO primero (por encima del logo en pintado en algunos casos).
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!;
      const fs = Math.max(14, Math.round((W * l.fontSizePct) / 100));
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) continue;
      setFontOnCtx(ctx, l, fs);
      const maxLineW = Math.round(W * 0.92);
      const lines = wrapText(ctx, l.text, maxLineW);
      const padX = Math.round(fs * 0.6);
      const padY = Math.round(fs * 0.3);
      const lineH = Math.round(fs * 1.18);
      const blockW =
        Math.max(...lines.map((ln) => Math.ceil(ctx.measureText(ln).width))) +
        padX * 2;
      const blockH = lines.length * lineH + padY * 2;
      const centerX = l.x * W;
      const centerY = l.y * H;
      const left = centerX - blockW / 2;
      const top = centerY - blockH / 2;
      if (cx >= left && cx <= left + blockW && cy >= top && cy <= top + blockH) {
        return { type: "layer", id: l.id };
      }
    }
    // Hit test logo
    if (logo.enabled && logoImgRef.current) {
      const targetW = Math.round((W * logo.sizePct) / 100);
      const ratio =
        logoImgRef.current.naturalHeight /
        Math.max(1, logoImgRef.current.naturalWidth);
      const targetH = Math.round(targetW * ratio);
      const centerX = logo.x * W;
      const centerY = logo.y * H;
      const left = centerX - targetW / 2;
      const top = centerY - targetH / 2;
      if (
        cx >= left &&
        cx <= left + targetW &&
        cy >= top &&
        cy <= top + targetH
      ) {
        return { type: "logo" };
      }
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = eventToCanvasCoords(e.clientX, e.clientY);
    if (!c) return;
    const hit = hitTest(c.cx, c.cy, c.W, c.H);
    if (!hit) {
      setSelectedLayerId(null);
      setLogoSelected(false);
      return;
    }
    if (hit.type === "logo") {
      setLogoSelected(true);
      setSelectedLayerId(null);
      dragRef.current = {
        type: "logo",
        layerId: null,
        startCanvasX: c.cx,
        startCanvasY: c.cy,
        startElemX: logo.x,
        startElemY: logo.y,
      };
    } else {
      setSelectedLayerId(hit.id);
      setLogoSelected(false);
      const l = layers.find((x) => x.id === hit.id);
      if (!l) return;
      dragRef.current = {
        type: "layer",
        layerId: hit.id,
        startCanvasX: c.cx,
        startCanvasY: c.cy,
        startElemX: l.x,
        startElemY: l.y,
      };
    }
    canvasRef.current?.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current.type) return;
    const c = eventToCanvasCoords(e.clientX, e.clientY);
    if (!c) return;
    const dx = (c.cx - dragRef.current.startCanvasX) / c.W;
    const dy = (c.cy - dragRef.current.startCanvasY) / c.H;
    const nx = clamp(dragRef.current.startElemX + dx, 0.05, 0.95);
    const ny = clamp(dragRef.current.startElemY + dy, 0.05, 0.95);
    if (dragRef.current.type === "logo") {
      setLogo((s) => ({ ...s, x: nx, y: ny }));
    } else if (dragRef.current.layerId) {
      const id = dragRef.current.layerId;
      setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, x: nx, y: ny } : l)));
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current.type = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  // ── Acciones de capas ──────────────────────────────────────────────────────
  function addTextLayer() {
    const id = cryptoRandomId();
    const next: TextLayer = {
      id,
      text: "Tu marca · 900 000 000",
      x: 0.5,
      y: 0.85,
      fontFamily: "Nunito Sans",
      fontSizePct: 3.5,
      color: "#FFFFFF",
      bold: true,
      italic: false,
      hasPanel: true,
    };
    setLayers((ls) => [...ls, next]);
    setSelectedLayerId(id);
    setActiveTab("estilo");
  }
  function removeLayer(id: string) {
    setLayers((ls) => ls.filter((l) => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  }
  function updateLayer(id: string, patch: Partial<TextLayer>) {
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  const selectedLayer = useMemo(
    () => layers.find((l) => l.id === selectedLayerId) ?? null,
    [layers, selectedLayerId],
  );

  // ── Guardar ────────────────────────────────────────────────────────────────
  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    startSave(async () => {
      try {
        const dataUrl = canvas.toDataURL("image/png");
        const r = await saveFinalPostImageAction(postId, dataUrl, {
          logo_applied: logo.enabled && !!logoImgRef.current,
          text_applied: layers.length > 0,
        });
        if (!r.ok) {
          notify.error("No se pudo guardar", r.error);
          return;
        }
        notify.success("Imagen guardada", "Lista para publicar.");
        onSaved();
      } catch (e) {
        notify.error(
          "Error guardando",
          e instanceof Error ? e.message : "Error desconocido",
        );
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* CANVAS GRANDE ARRIBA */}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-xl border bg-[repeating-conic-gradient(#f1f5f9_0deg_90deg,#e2e8f0_90deg_180deg)] bg-[length:24px_24px]"
      >
        {ready ? (
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="block max-h-[58vh] w-full touch-none object-contain"
            style={{ touchAction: "none", cursor: "move" }}
            aria-label="Previsualización editable"
          />
        ) : (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            Cargando imagen…
          </div>
        )}
      </div>

      {/* TIP DE USO */}
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          <strong>Truco:</strong> haz click sobre el logo o un texto y arrástralo
          para moverlo. Click fuera para deseleccionar.
        </span>
        {(selectedLayer || logoSelected) && (
          <span className="rounded bg-primary px-2 py-0.5 font-bold text-primary-foreground">
            {logoSelected ? "Logo seleccionado" : "Texto seleccionado"}
          </span>
        )}
      </div>

      {/* PANEL CONTROLES ABAJO con pestañas */}
      <div className="rounded-xl border bg-card">
        <div className="flex border-b">
          <button
            type="button"
            onClick={() => setActiveTab("capas")}
            className={`flex flex-1 items-center justify-center gap-2 py-2 text-sm font-semibold ${
              activeTab === "capas"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            <LayersIcon className="h-4 w-4" aria-hidden="true" />
            Capas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("estilo")}
            className={`flex flex-1 items-center justify-center gap-2 py-2 text-sm font-semibold ${
              activeTab === "estilo"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            <Sliders className="h-4 w-4" aria-hidden="true" />
            Estilo {selectedLayer ? "del texto" : logoSelected ? "del logo" : ""}
          </button>
        </div>

        <div className="p-3">
          {activeTab === "capas" && (
            <div className="space-y-3">
              {/* LOGO */}
              <div className="flex items-center justify-between rounded-lg border bg-background p-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-lg">🏷️</span>
                  <div>
                    <div className="font-semibold">Logo de empresa</div>
                    {!logoUrl && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <ImageOff className="h-3 w-3" aria-hidden="true" />
                        Sube uno en /configuracion/fiscal
                      </div>
                    )}
                  </div>
                </div>
                <Switch
                  checked={logo.enabled && !!logoUrl}
                  onCheckedChange={(v) => setLogo((s) => ({ ...s, enabled: v }))}
                  disabled={!logoUrl}
                />
              </div>

              {/* TEXTOS */}
              <div className="space-y-2">
                {layers.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed p-4 text-center text-xs text-muted-foreground">
                    Sin capas de texto. Pulsa{" "}
                    <strong>Añadir texto</strong> para empezar.
                  </div>
                ) : (
                  layers.map((l) => (
                    <button
                      type="button"
                      key={l.id}
                      onClick={() => {
                        setSelectedLayerId(l.id);
                        setLogoSelected(false);
                        setActiveTab("estilo");
                      }}
                      className={`flex w-full items-center justify-between rounded-lg border p-2 text-left text-sm transition-colors ${
                        selectedLayerId === l.id
                          ? "border-primary bg-primary/5"
                          : "bg-background hover:bg-muted/40"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Type className="h-4 w-4" aria-hidden="true" />
                        <span
                          className="truncate"
                          style={{ fontFamily: `"${l.fontFamily}"` }}
                        >
                          {l.text || "(vacío)"}
                        </span>
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLayer(l.id);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                        aria-label="Eliminar capa"
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </button>
                  ))
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={addTextLayer}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Añadir texto
                </Button>
              </div>
            </div>
          )}

          {activeTab === "estilo" && (
            <>
              {selectedLayer ? (
                <TextLayerEditor
                  layer={selectedLayer}
                  onChange={(patch) => updateLayer(selectedLayer.id, patch)}
                />
              ) : logoSelected ? (
                <LogoEditor
                  logo={logo}
                  onChange={(patch) => setLogo((s) => ({ ...s, ...patch }))}
                />
              ) : (
                <div className="rounded-lg border-2 border-dashed p-4 text-center text-xs text-muted-foreground">
                  Selecciona una capa (click sobre la imagen o en la lista) para
                  editar su estilo.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* BOTONES FIJOS */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onSkip}>
          <X className="h-4 w-4" aria-hidden="true" />
          Saltar sin overlay
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          loading={pendingSave}
          loadingText="Guardando…"
          disabled={!ready}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Guardar imagen final
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-editores
// ─────────────────────────────────────────────────────────────────────────────

function TextLayerEditor({
  layer,
  onChange,
}: {
  layer: TextLayer;
  onChange: (patch: Partial<TextLayer>) => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">
          Texto
        </Label>
        <Input
          value={layer.text}
          onChange={(e) => onChange({ text: e.target.value })}
          maxLength={120}
          placeholder="Escribe el texto…"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">
            Fuente
          </Label>
          <Select
            value={layer.fontFamily}
            onValueChange={(v) => onChange({ fontFamily: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_OPTIONS.map((f) => (
                <SelectItem
                  key={f.value}
                  value={f.value}
                >
                  <span style={{ fontFamily: `"${f.value}"` }}>{f.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">
            Tamaño ({layer.fontSizePct.toFixed(1)}%)
          </Label>
          <input
            type="range"
            min={2}
            max={10}
            step={0.1}
            value={layer.fontSizePct}
            onChange={(e) =>
              onChange({ fontSizePct: Number(e.target.value) })
            }
            className="w-full"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">
            Color
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={layer.color}
              onChange={(e) =>
                onChange({ color: e.target.value.toUpperCase() })
              }
              className="h-9 w-12 cursor-pointer rounded border bg-background"
            />
            <Input
              value={layer.color}
              onChange={(e) =>
                onChange({ color: e.target.value.toUpperCase() })
              }
              className="font-mono text-xs"
              maxLength={7}
            />
          </div>
        </div>

        <div className="flex items-end gap-3 pt-3 sm:pt-0">
          <ToggleSm
            label="Negrita"
            checked={layer.bold}
            onChange={(v) => onChange({ bold: v })}
          />
          <ToggleSm
            label="Cursiva"
            checked={layer.italic}
            onChange={(v) => onChange({ italic: v })}
          />
          <ToggleSm
            label="Fondo"
            checked={layer.hasPanel}
            onChange={(v) => onChange({ hasPanel: v })}
          />
        </div>
      </div>
    </div>
  );
}

function LogoEditor({
  logo,
  onChange,
}: {
  logo: LogoState;
  onChange: (patch: Partial<LogoState>) => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">
          Tamaño del logo ({logo.sizePct}% del ancho)
        </Label>
        <input
          type="range"
          min={5}
          max={40}
          step={1}
          value={logo.sizePct}
          onChange={(e) => onChange({ sizePct: Number(e.target.value) })}
          className="w-full"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Para colocarlo, arrástralo directamente sobre la imagen.
      </p>
    </div>
  );
}

function ToggleSm({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex flex-col items-start gap-1">
      <span className="text-[10px] uppercase text-muted-foreground">
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas drawing
// ─────────────────────────────────────────────────────────────────────────────

function drawLogo(
  ctx: CanvasRenderingContext2D,
  logoImg: HTMLImageElement,
  W: number,
  H: number,
  logo: LogoState,
) {
  const sizePct = clamp(logo.sizePct, 5, 40);
  const targetW = Math.round((W * sizePct) / 100);
  const ratio = logoImg.naturalHeight / Math.max(1, logoImg.naturalWidth);
  const targetH = Math.round(targetW * ratio);
  const centerX = logo.x * W;
  const centerY = logo.y * H;
  ctx.drawImage(
    logoImg,
    centerX - targetW / 2,
    centerY - targetH / 2,
    targetW,
    targetH,
  );
}

function setFontOnCtx(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  fontSize: number,
) {
  const weight = layer.bold ? "900" : "400";
  const style = layer.italic ? "italic" : "normal";
  ctx.font = `${style} ${weight} ${fontSize}px "${layer.fontFamily}", "Nunito Sans", "Inter", "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  layer: TextLayer,
) {
  const text = layer.text.trim();
  if (!text) return;
  const fontSize = Math.max(14, Math.round((W * layer.fontSizePct) / 100));
  setFontOnCtx(ctx, layer, fontSize);

  const maxLineW = Math.round(W * 0.92);
  const lines = wrapText(ctx, text, maxLineW);
  const lineH = Math.round(fontSize * 1.18);
  const blockW = Math.max(
    ...lines.map((l) => Math.ceil(ctx.measureText(l).width)),
  );
  const blockH = lines.length * lineH;
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.3);
  const panelW = blockW + padX * 2;
  const panelH = blockH + padY * 2;

  const centerX = layer.x * W;
  const centerY = layer.y * H;
  const panelLeft = centerX - panelW / 2;
  const panelTop = centerY - panelH / 2;

  // Panel de fondo
  if (layer.hasPanel) {
    const pc = panelColorFor(layer.color);
    ctx.fillStyle = `rgba(${pc.r},${pc.g},${pc.b},${pc.alpha})`;
    roundRect(
      ctx,
      panelLeft,
      panelTop,
      panelW,
      panelH,
      Math.round(fontSize * 0.3),
    );
    ctx.fill();
  } else {
    // Sin panel: sombra para legibilidad sobre cualquier fondo
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = Math.round(fontSize * 0.25);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(fontSize * 0.05);
  }

  // Texto
  ctx.fillStyle = layer.color;
  lines.forEach((l, i) => {
    ctx.fillText(l, panelLeft + padX, panelTop + padY + i * lineH);
  });

  // Reset sombras
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function panelColorFor(textHex: string): {
  r: number;
  g: number;
  b: number;
  alpha: number;
} {
  const h = textHex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140
    ? { r: 0, g: 0, b: 0, alpha: 0.5 }
    : { r: 255, g: 255, b: 255, alpha: 0.7 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function cryptoRandomId(): string {
  return (
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  ).slice(0, 12);
}

/** Convierte la posición predefinida del overlay original a coordenadas 0-1. */
function positionFromOverlayPos(
  pos: string,
): { x: number; y: number } {
  switch (pos) {
    case "top-left":
      return { x: 0.18, y: 0.1 };
    case "top-right":
      return { x: 0.82, y: 0.1 };
    case "bottom-left":
      return { x: 0.18, y: 0.9 };
    case "bottom-right":
      return { x: 0.82, y: 0.9 };
    case "bottom-center":
    default:
      return { x: 0.5, y: 0.9 };
  }
}
