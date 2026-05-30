/**
 * Overlay post-generación: pega el logo de la empresa y/o un texto de marca
 * de agua sobre la imagen que devolvió Gemini. Esto es DETERMINISTA y rápido
 * (~50–150 ms) — al contrario de pedirle a la IA que "dibuje el logo", aquí
 * el resultado es píxel-perfecto: el logo real de la empresa, en la esquina
 * exacta, con el tamaño exacto.
 *
 * Librería: sharp (libvips bajo el capó). Vercel la soporta de forma nativa
 * porque Next.js Image la usa internamente.
 */

import sharp from "sharp";
import type {
  OverlayPosition,
  ResolvedOverlaySettings,
  WatermarkPosition,
} from "./image-types";

export interface OverlayResult {
  ok: boolean;
  bytes?: Buffer;
  mime_type?: string;
  /** Mensaje cuando algo no crítico falla (ej.: logo URL inaccesible). */
  warning?: string;
}

/**
 * Aplica logo + texto sobre una imagen. Si no hay nada que aplicar
 * (ambos disabled), devuelve los bytes originales sin tocar.
 */
export async function applyOverlay(
  imageBytes: Buffer,
  resolved: ResolvedOverlaySettings,
): Promise<OverlayResult> {
  const needsLogo = resolved.logo_enabled && resolved.logo_url;
  const needsText =
    resolved.watermark_text_enabled &&
    !!resolved.watermark_text &&
    resolved.watermark_text.trim().length > 0;

  if (!needsLogo && !needsText) {
    return { ok: true, bytes: imageBytes, mime_type: "image/png" };
  }

  let warning: string | undefined;

  try {
    // Cargamos la imagen base + sus dimensiones para calcular paddings.
    const base = sharp(imageBytes);
    const meta = await base.metadata();
    const W = meta.width ?? 1024;
    const H = meta.height ?? 1024;

    const composites: sharp.OverlayOptions[] = [];

    // ── LOGO ──────────────────────────────────────────────────────────────────
    if (needsLogo && resolved.logo_url) {
      try {
        const logoRes = await fetch(resolved.logo_url);
        if (!logoRes.ok) {
          warning = `No se pudo descargar el logo (HTTP ${logoRes.status}). Imagen generada sin logo.`;
        } else {
          const logoBuf = Buffer.from(await logoRes.arrayBuffer());
          const sizePct = clamp(resolved.logo_size_pct, 5, 30);
          const targetW = Math.round((W * sizePct) / 100);
          // Redimensionamos el logo manteniendo aspecto, sobre canal alpha para que
          // siga teniendo transparencia si era PNG.
          const resizedLogo = await sharp(logoBuf)
            .resize({ width: targetW, withoutEnlargement: false })
            .png()
            .toBuffer();
          const resizedMeta = await sharp(resizedLogo).metadata();
          const lW = resizedMeta.width ?? targetW;
          const lH = resizedMeta.height ?? targetW;
          const padding = Math.round(W * 0.03);
          const { top, left } = positionToCoords(
            resolved.logo_position,
            W,
            H,
            lW,
            lH,
            padding,
          );
          composites.push({ input: resizedLogo, top, left });
        }
      } catch (e) {
        warning = `Error procesando logo: ${
          e instanceof Error ? e.message : "desconocido"
        }. Imagen generada sin logo.`;
      }
    }

    // ── TEXTO MARCA DE AGUA ───────────────────────────────────────────────────
    if (needsText && resolved.watermark_text) {
      const text = resolved.watermark_text.trim();
      const fontSize = Math.max(20, Math.round(W * 0.035)); // ~36px en 1024
      const color = sanitizeHex(resolved.watermark_text_color, "#FFFFFF");
      const outline = autoContrastOutline(color);
      // Generamos un SVG del tamaño completo de la imagen y colocamos el texto
      // en la posición pedida — composite lo aplica encima directamente.
      const svg = buildTextSvg({
        text,
        position: resolved.watermark_text_position,
        canvasW: W,
        canvasH: H,
        fontSize,
        color,
        outline,
      });
      composites.push({ input: Buffer.from(svg), top: 0, left: 0 });
    }

    const out = await base.composite(composites).png().toBuffer();
    return { ok: true, bytes: out, mime_type: "image/png", warning };
  } catch (e) {
    return {
      ok: false,
      warning: `Overlay falló: ${
        e instanceof Error ? e.message : "error desconocido"
      }`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function positionToCoords(
  pos: OverlayPosition,
  W: number,
  H: number,
  w: number,
  h: number,
  padding: number,
): { top: number; left: number } {
  switch (pos) {
    case "top-left":
      return { top: padding, left: padding };
    case "top-right":
      return { top: padding, left: W - w - padding };
    case "bottom-left":
      return { top: H - h - padding, left: padding };
    case "bottom-right":
    default:
      return { top: H - h - padding, left: W - w - padding };
  }
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

/** Contorno de contraste automático sobre el color del texto. */
function autoContrastOutline(hex: string): string {
  // luminancia aproximada (0..255) — si > 140 el texto es claro → contorno oscuro.
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140 ? "#000000" : "#FFFFFF";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildTextSvg(opts: {
  text: string;
  position: WatermarkPosition;
  canvasW: number;
  canvasH: number;
  fontSize: number;
  color: string;
  outline: string;
}): string {
  const { text, position, canvasW, canvasH, fontSize, color, outline } = opts;
  const padding = Math.round(canvasW * 0.04);
  // Posicionamiento por anclas SVG. y es la BASELINE, no el top, así que sumamos fontSize cuando va arriba.
  let x: number;
  let y: number;
  let anchor: "start" | "middle" | "end";
  switch (position) {
    case "top-left":
      x = padding;
      y = padding + fontSize;
      anchor = "start";
      break;
    case "top-right":
      x = canvasW - padding;
      y = padding + fontSize;
      anchor = "end";
      break;
    case "bottom-left":
      x = padding;
      y = canvasH - padding;
      anchor = "start";
      break;
    case "bottom-right":
      x = canvasW - padding;
      y = canvasH - padding;
      anchor = "end";
      break;
    case "bottom-center":
    default:
      x = canvasW / 2;
      y = canvasH - padding;
      anchor = "middle";
      break;
  }
  const escapedText = escapeXml(text);
  // Tipografía sans-serif del sistema (libvips/fontconfig resuelve a la
  // disponible en el contenedor — DejaVu Sans en Vercel funciona bien).
  return `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .wm {
      font-family: -apple-system, "Segoe UI", "DejaVu Sans", Arial, sans-serif;
      font-weight: 700;
      font-size: ${fontSize}px;
      paint-order: stroke;
      stroke: ${outline};
      stroke-width: ${Math.max(2, Math.round(fontSize / 12))}px;
      stroke-linejoin: round;
    }
  </style>
  <text x="${x}" y="${y}" class="wm" fill="${color}" text-anchor="${anchor}">${escapedText}</text>
</svg>`;
}
