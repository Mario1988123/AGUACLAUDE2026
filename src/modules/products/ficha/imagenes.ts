/**
 * Imágenes para la ficha PDF, pasadas por sharp (servidor).
 *
 * pdf-lib solo incrusta PNG y JPG, y las 1.016 fotos del maestro son .webp:
 * antes se decidía el formato por la extensión de la URL y las .webp se
 * perdían en silencio. Aquí se mira el contenido, se convierte siempre y se
 * reduce a un tamaño razonable para el papel.
 */

import http from "node:http";
import https from "node:https";
import sharp from "sharp";
import type { PDFDocument, PDFImage } from "pdf-lib";
import { coloresDominantes } from "./colores-logo";

export interface ImagenLista {
  bytes: Uint8Array;
  formato: "png" | "jpg";
  ancho: number;
  alto: number;
}

/**
 * Descarga con tiempo máximo. Null si falla (la ficha sigue sin esa imagen).
 *
 * Con node:https y no con fetch: el fetch parcheado de Next guarda en `next
 * dev` las respuestas de los componentes de servidor y, con una imagen de
 * cientos de KB, revienta la pila al servir la página («Maximum call stack
 * size exceeded», visto el 27-11 con el logo de Infinity en /configuracion/pdf).
 */
export function descargar(url: string | null | undefined, ms = 15000, saltos = 3): Promise<Buffer | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    const cliente = u.protocol === "http:" ? http : https;
    const req = cliente.get(u, { timeout: ms }, (res) => {
      const estado = res.statusCode ?? 0;
      if (estado >= 300 && estado < 400 && res.headers.location && saltos > 0) {
        res.resume();
        resolve(descargar(new URL(res.headers.location, u).toString(), ms, saltos - 1));
        return;
      }
      if (estado < 200 || estado >= 300) {
        res.resume();
        console.error(`[ficha] imagen ${estado}: ${u.origin}${u.pathname}`);
        resolve(null);
        return;
      }
      const trozos: Buffer[] = [];
      res.on("data", (c: Buffer) => trozos.push(c));
      res.on("end", () => resolve(Buffer.concat(trozos)));
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => req.destroy(new Error("tiempo agotado")));
    req.on("error", (e) => {
      console.error("[ficha] imagen:", e.message);
      resolve(null);
    });
  });
}

/**
 * Cualquier formato (webp, png, jpg, gif, avif…) → PNG si tiene transparencia,
 * JPG si no. `recortar` quita el margen blanco o transparente (logos).
 */
export async function prepararImagen(
  buf: Buffer | null,
  opciones: { maxPx?: number; recortar?: boolean } = {},
): Promise<ImagenLista | null> {
  if (!buf) return null;
  try {
    const maxPx = opciones.maxPx ?? 1400;
    let img = sharp(buf, { failOn: "none" }).rotate();
    if (opciones.recortar) {
      const meta = await img.metadata();
      img = sharp(
        await img
          .trim({ background: meta.hasAlpha ? { r: 0, g: 0, b: 0, alpha: 0 } : "#ffffff", threshold: 12 })
          .toBuffer(),
      );
    }
    img = img.resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true });
    const meta = await img.metadata();
    const conAlfa = !!meta.hasAlpha;
    const { data, info } = conAlfa
      ? await img.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true })
      : await img.flatten({ background: "#ffffff" }).jpeg({ quality: 86 }).toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), formato: conAlfa ? "png" : "jpg", ancho: info.width, alto: info.height };
  } catch (e) {
    console.error("[ficha] convertir imagen:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Icono de ventaja reentintado («Del Icono Reentintado»): el trazo oscuro del
 * icono pasa a ser el color de la empresa y el cuadrado pálido de fondo
 * desaparece. Devuelve un PNG transparente.
 */
export async function repintarIcono(buf: Buffer | null, hex: string, px = 160): Promise<ImagenLista | null> {
  if (!buf) return null;
  try {
    const { data, info } = await sharp(buf, { failOn: "none" })
      .resize({ width: px, height: px, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const out = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * 4;
      const lum = (0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!) / 255;
      // Fondo pálido (L ≈ 0,9) → 0; trazo (L ≲ 0,45) → 1; borde suave en medio.
      const m = Math.min(1, Math.max(0, (0.86 - lum) / 0.41)) * (data[o + 3]! / 255);
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(m * 255);
    }
    const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(png.data), formato: "png", ancho: png.info.width, alto: png.info.height };
  } catch (e) {
    console.error("[ficha] repintar icono:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Hasta tres colores del logo (vacío si es SVG, negro o no se puede leer). */
export async function coloresDeLogo(buf: Buffer | null): Promise<string[]> {
  if (!buf) return [];
  try {
    const { data } = await sharp(buf, { failOn: "none" })
      // Sin suavizar (vecino más próximo): los bordes difuminados con el blanco
      // darían colores lavados.
      .resize({ width: 160, height: 160, fit: "inside", kernel: "nearest" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return coloresDominantes(new Uint8Array(data));
  } catch {
    return [];
  }
}

/** Incrusta en el PDF lo que devolvió prepararImagen. */
export async function incrustar(pdf: PDFDocument, img: ImagenLista | null): Promise<PDFImage | null> {
  if (!img) return null;
  try {
    return img.formato === "png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
  } catch (e) {
    console.error("[ficha] incrustar:", e instanceof Error ? e.message : e);
    return null;
  }
}
