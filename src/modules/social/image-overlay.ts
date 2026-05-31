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
import type { OverlayPosition, ResolvedOverlaySettings } from "./image-types";

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
      try {
        const textImg = await renderWatermarkText(
          resolved.watermark_text.trim(),
          resolved.watermark_text_color,
          W,
        );
        if (textImg) {
          const padding = Math.round(W * 0.03);
          const { top, left } = positionToCoords(
            // bottom-center es válido aquí — calculamos coords ad-hoc
            resolved.watermark_text_position === "bottom-center"
              ? "bottom-right" // posición ignorada, recalculamos abajo
              : resolved.watermark_text_position,
            W,
            H,
            textImg.width,
            textImg.height,
            padding,
          );
          let finalLeft = left;
          let finalTop = top;
          if (resolved.watermark_text_position === "bottom-center") {
            finalLeft = Math.round((W - textImg.width) / 2);
            finalTop = H - textImg.height - padding;
          }
          composites.push({
            input: textImg.buffer,
            top: finalTop,
            left: finalLeft,
          });
        }
      } catch (e) {
        warning = `Error pintando texto: ${
          e instanceof Error ? e.message : "desconocido"
        }. Imagen generada sin texto.`;
      }
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Renderiza el texto con la API nativa de sharp ({ text: ... }) que usa Pango
 * bajo el capó — mucho más fiable que SVG en entornos serverless como Vercel
 * (donde el matching de fuentes en SVG es quisquilloso). Sobre el texto pinta
 * un panel rectangular semi-transparente para garantizar legibilidad sobre
 * cualquier imagen (claro u oscura).
 *
 * Devuelve un PNG con el texto sobre el panel, y sus dimensiones para que
 * el composite del caller lo posicione donde toca.
 */
async function renderWatermarkText(
  text: string,
  colorRaw: string,
  canvasWidth: number,
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  if (!text) return null;
  const fontSize = Math.max(22, Math.round(canvasWidth * 0.035)); // ~36px en 1024
  const color = sanitizeHex(colorRaw, "#FFFFFF");
  const panelColor = panelColorFor(color);
  const maxTextWidth = Math.round(canvasWidth * 0.9);
  // Markup Pango: <span> con color + size. size es en milésimas de punto
  // (1pt = 1024 unidades aprox), pero pasamos px directos vía font.
  const escapedText = escapeXml(text);
  const markup = `<span foreground="${color}" weight="bold">${escapedText}</span>`;

  // Renderiza el texto. Pango respeta fontconfig → en Vercel resuelve a
  // DejaVu Sans / Noto Sans (siempre disponibles en el contenedor).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textBuf = await (sharp as any)({
    text: {
      text: markup,
      font: `sans-serif ${fontSize}px`,
      rgba: true,
      width: maxTextWidth,
      wrap: "word",
    },
  })
    .png()
    .toBuffer();

  const textMeta = await sharp(textBuf).metadata();
  const tW = textMeta.width ?? Math.round(text.length * fontSize * 0.5);
  const tH = textMeta.height ?? fontSize;

  // Panel de fondo: ancho del texto + padding, alto del texto + padding.
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.35);
  const panelW = tW + padX * 2;
  const panelH = tH + padY * 2;
  const panel = await sharp({
    create: {
      width: panelW,
      height: panelH,
      channels: 4,
      background: panelColor,
    },
  })
    .png()
    .toBuffer();

  const composed = await sharp(panel)
    .composite([{ input: textBuf, top: padY, left: padX }])
    .png()
    .toBuffer();

  return { buffer: composed, width: panelW, height: panelH };
}

/**
 * Color del panel de fondo bajo el texto. Si el texto es claro → panel negro
 * 45%; si es oscuro → panel blanco 65%. Garantiza contraste siempre.
 */
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
    ? { r: 0, g: 0, b: 0, alpha: 0.45 } // texto claro → panel oscuro
    : { r: 255, g: 255, b: 255, alpha: 0.65 }; // texto oscuro → panel claro
}
