"use client";

/**
 * OverlayCanvas — Editor cliente para aplicar logo + texto sobre una imagen IA.
 *
 * Reemplaza el overlay server-side (sharp + Pango) que en Vercel/Lambda devolvía
 * "tofu" (cuadrados □□□) porque no había fuentes instaladas en el contenedor.
 *
 * Aquí toda la composición se hace en el navegador con HTML5 Canvas. El navegador
 * sí tiene fuentes nativas (system fonts + las que carga Next via Google Fonts),
 * así que el texto se renderiza nítido y siempre.
 *
 * Al pulsar "Guardar", se exporta el canvas a PNG (toBlob) y se manda a la
 * server action para sustituir la imagen en Storage.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { Save, RotateCcw, X, MoveDiagonal, ImageOff } from "lucide-react";
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
import type {
  OverlayPosition,
  WatermarkPosition,
  ResolvedOverlaySettings,
} from "./image-types";

interface Props {
  postId: string;
  /** URL pública de la imagen IA (ya en Storage, sin overlay). */
  imageUrl: string;
  /** URL pública del logo de la empresa (puede ser null). */
  logoUrl: string | null;
  /** Settings iniciales resueltos en el servidor (defaults + overrides). */
  initialOverlay: ResolvedOverlaySettings;
  onSaved: () => void;
  onSkip: () => void;
}

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

export function OverlayCanvas({
  postId,
  imageUrl,
  logoUrl,
  initialOverlay,
  onSaved,
  onSkip,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  const [overlay, setOverlay] = useState<ResolvedOverlaySettings>(initialOverlay);
  const [ready, setReady] = useState(false);
  const [pendingSave, startSave] = useTransition();

  // ── Carga de imágenes ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadImg(src: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        // CORS: Supabase Storage devuelve Access-Control-Allow-Origin: *.
        // crossOrigin "anonymous" permite usar la imagen en canvas sin "taint".
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = src;
      });
    }

    (async () => {
      try {
        const base = await loadImg(imageUrl);
        if (cancelled) return;
        baseImgRef.current = base;

        if (logoUrl) {
          try {
            const logo = await loadImg(logoUrl);
            if (cancelled) return;
            logoImgRef.current = logo;
          } catch {
            // Logo opcional. Si falla la carga, seguimos sin él.
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

  // ── Repintar cada vez que cambia algo ──────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const base = baseImgRef.current;
    if (!canvas || !base) return;

    const W = base.naturalWidth || 1024;
    const H = base.naturalHeight || 1024;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0, W, H);

    // ── LOGO ──
    if (overlay.logo_enabled && logoImgRef.current) {
      drawLogo(ctx, logoImgRef.current, W, H, overlay);
    }

    // ── TEXTO ──
    if (overlay.watermark_text_enabled && overlay.watermark_text) {
      drawWatermarkText(ctx, W, H, overlay);
    }
  }, [ready, overlay]);

  // ── Guardar ────────────────────────────────────────────────────────────────
  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    startSave(async () => {
      try {
        // Convertimos canvas → dataURL (base64 PNG).
        const dataUrl = canvas.toDataURL("image/png");
        const r = await saveFinalPostImageAction(postId, dataUrl, {
          logo_applied: overlay.logo_enabled && !!logoImgRef.current,
          text_applied:
            overlay.watermark_text_enabled &&
            !!overlay.watermark_text &&
            overlay.watermark_text.trim().length > 0,
        });
        if (!r.ok) {
          notify.error("No se pudo guardar", r.error);
          return;
        }
        notify.success("Imagen guardada", "La imagen final está lista.");
        onSaved();
      } catch (e) {
        notify.error(
          "Error guardando",
          e instanceof Error ? e.message : "Error desconocido",
        );
      }
    });
  }

  // ── Helpers para el panel lateral ──────────────────────────────────────────
  function setO<K extends keyof ResolvedOverlaySettings>(
    k: K,
    v: ResolvedOverlaySettings[K],
  ) {
    setOverlay((o) => ({ ...o, [k]: v }));
  }
  function resetToInitial() {
    setOverlay(initialOverlay);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* PREVIEW canvas */}
        <div className="overflow-hidden rounded-xl border bg-checker">
          {ready ? (
            <canvas
              ref={canvasRef}
              className="max-h-[60vh] w-full object-contain"
              aria-label="Previsualización de la imagen final"
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              Cargando imagen…
            </div>
          )}
        </div>

        {/* PANEL controles overlay */}
        <div className="space-y-4 rounded-xl border bg-card p-3 text-sm">
          {/* LOGO */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs font-bold uppercase text-muted-foreground">
                Logo de empresa
              </Label>
              <Switch
                checked={overlay.logo_enabled && !!logoUrl}
                onCheckedChange={(v) => setO("logo_enabled", v)}
                disabled={!logoUrl}
              />
            </div>
            {!logoUrl && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ImageOff className="h-3 w-3" aria-hidden="true" /> Sin logo en
                /configuracion/fiscal
              </p>
            )}
            <div className="grid gap-2 pt-2">
              <Select
                value={overlay.logo_position}
                onValueChange={(v) => setO("logo_position", v as OverlayPosition)}
                disabled={!overlay.logo_enabled || !logoUrl}
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
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">
                  Tamaño ({overlay.logo_size_pct}%)
                </Label>
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={overlay.logo_size_pct}
                  onChange={(e) => setO("logo_size_pct", Number(e.target.value))}
                  className="w-full"
                  disabled={!overlay.logo_enabled || !logoUrl}
                />
              </div>
            </div>
          </div>

          <hr className="border-border" />

          {/* TEXTO */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs font-bold uppercase text-muted-foreground">
                Texto sobreimpreso
              </Label>
              <Switch
                checked={overlay.watermark_text_enabled}
                onCheckedChange={(v) => setO("watermark_text_enabled", v)}
              />
            </div>
            <div className="grid gap-2 pt-1">
              <Input
                value={overlay.watermark_text ?? ""}
                onChange={(e) => setO("watermark_text", e.target.value || null)}
                placeholder="Ej.: HidroPura · 900 123 456"
                maxLength={80}
                disabled={!overlay.watermark_text_enabled}
              />
              <Select
                value={overlay.watermark_text_position}
                onValueChange={(v) =>
                  setO("watermark_text_position", v as WatermarkPosition)
                }
                disabled={!overlay.watermark_text_enabled}
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
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={overlay.watermark_text_color || "#FFFFFF"}
                  onChange={(e) =>
                    setO("watermark_text_color", e.target.value.toUpperCase())
                  }
                  className="h-9 w-12 cursor-pointer rounded border bg-background"
                  aria-label="Color texto"
                  disabled={!overlay.watermark_text_enabled}
                />
                <Input
                  value={overlay.watermark_text_color ?? "#FFFFFF"}
                  onChange={(e) =>
                    setO("watermark_text_color", e.target.value.toUpperCase())
                  }
                  className="font-mono text-xs"
                  maxLength={7}
                  disabled={!overlay.watermark_text_enabled}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ACCIONES */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MoveDiagonal className="h-3 w-3" aria-hidden="true" />
          La preview muestra el resultado EXACTO que se guardará.
        </p>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetToInitial}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Restablecer
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onSkip}>
            <X className="h-4 w-4" aria-hidden="true" />
            Sin overlay
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Funciones de pintado en canvas
// ─────────────────────────────────────────────────────────────────────────────

function drawLogo(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  W: number,
  H: number,
  overlay: ResolvedOverlaySettings,
) {
  const sizePct = clamp(overlay.logo_size_pct, 5, 30);
  const targetW = Math.round((W * sizePct) / 100);
  const ratio = logo.naturalHeight / Math.max(1, logo.naturalWidth);
  const targetH = Math.round(targetW * ratio);
  const padding = Math.round(W * 0.03);
  const { x, y } = positionToCoords(
    overlay.logo_position,
    W,
    H,
    targetW,
    targetH,
    padding,
  );
  ctx.drawImage(logo, x, y, targetW, targetH);
}

function drawWatermarkText(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  overlay: ResolvedOverlaySettings,
) {
  const text = (overlay.watermark_text ?? "").trim();
  if (!text) return;

  // Tamaño escala con el ancho del canvas (~3.5% del ancho).
  const fontSize = Math.max(22, Math.round(W * 0.035));
  const color = sanitizeHex(overlay.watermark_text_color, "#FFFFFF");
  const panelColor = panelColorFor(color);

  // Fuente: usar las del sistema, que SÍ existen en el navegador.
  ctx.font = `bold ${fontSize}px "Nunito Sans", "Inter", "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // Wrap a 90 % del ancho de canvas.
  const maxTextWidth = Math.round(W * 0.9);
  const lines = wrapText(ctx, text, maxTextWidth);
  const lineHeight = Math.round(fontSize * 1.2);
  const textBlockW = Math.max(
    ...lines.map((l) => Math.ceil(ctx.measureText(l).width)),
  );
  const textBlockH = lines.length * lineHeight - (lineHeight - fontSize); // último sin sobra

  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.35);
  const panelW = textBlockW + padX * 2;
  const panelH = textBlockH + padY * 2;

  // Posicionar el panel
  const padding = Math.round(W * 0.03);
  let panelLeft: number;
  let panelTop: number;
  if (overlay.watermark_text_position === "bottom-center") {
    panelLeft = Math.round((W - panelW) / 2);
    panelTop = H - panelH - padding;
  } else {
    const pos = positionToCoords(
      overlay.watermark_text_position as OverlayPosition,
      W,
      H,
      panelW,
      panelH,
      padding,
    );
    panelLeft = pos.x;
    panelTop = pos.y;
  }

  // Panel de fondo semi-transparente
  ctx.fillStyle = `rgba(${panelColor.r},${panelColor.g},${panelColor.b},${panelColor.alpha})`;
  // Esquinas redondeadas
  roundRect(ctx, panelLeft, panelTop, panelW, panelH, Math.round(fontSize * 0.3));
  ctx.fill();

  // Texto
  ctx.fillStyle = color;
  lines.forEach((l, i) => {
    ctx.fillText(l, panelLeft + padX, panelTop + padY + i * lineHeight);
  });
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

function positionToCoords(
  pos: OverlayPosition,
  W: number,
  H: number,
  w: number,
  h: number,
  padding: number,
): { x: number; y: number } {
  switch (pos) {
    case "top-left":
      return { x: padding, y: padding };
    case "top-right":
      return { x: W - w - padding, y: padding };
    case "bottom-left":
      return { x: padding, y: H - h - padding };
    case "bottom-right":
    default:
      return { x: W - w - padding, y: H - h - padding };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sanitizeHex(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(v)) {
    const r = v[1]!,
      g = v[2]!,
      b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function panelColorFor(textHex: string): {
  r: number;
  g: number;
  b: number;
  alpha: number;
} {
  const r = parseInt(textHex.slice(1, 3), 16);
  const g = parseInt(textHex.slice(3, 5), 16);
  const b = parseInt(textHex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140
    ? { r: 0, g: 0, b: 0, alpha: 0.5 }
    : { r: 255, g: 255, b: 255, alpha: 0.7 };
}
