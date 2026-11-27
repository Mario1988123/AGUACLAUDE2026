import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { descargar, prepararImagen } from "@/modules/products/ficha/imagenes";
import { derivarPaletaPropuesta } from "@/modules/captacion/propuesta-logica";
import { cargarEmpresaPropuesta } from "@/modules/captacion/propuesta-servidor";

export const dynamic = "force-dynamic";

/**
 * /p/og/[empresa] — imagen de la vista previa de WhatsApp (diseño §5.7):
 * una por EMPRESA, no por propuesta, en una URL sin el código. El logo sobre
 * el papel de la hoja con el filete del membrete; 1.200 × 630, JPG. Sin logo
 * no hay imagen (la página no la declara).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse(null, { status: 404 });
  const empresa = await cargarEmpresaPropuesta(id);
  if (!empresa?.logoUrl) return new NextResponse(null, { status: 404 });
  const logo = await prepararImagen(await descargar(empresa.logoUrl), { maxPx: 1200, recortar: true });
  if (!logo) return new NextResponse(null, { status: 404 });

  const p = derivarPaletaPropuesta(empresa.primario, empresa.acento);
  const ancho = 1200;
  const alto = 630;
  const logoListo = await sharp(Buffer.from(logo.bytes))
    .resize({ width: 640, height: 240, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const filete = await sharp({ create: { width: ancho - 160, height: 4, channels: 3, background: p.trazo } }).png().toBuffer();
  const jpg = await sharp({ create: { width: ancho, height: alto, channels: 3, background: p.hoja } })
    .composite([
      { input: logoListo.data, left: 80, top: Math.round((alto - logoListo.info.height) / 2) - 20 },
      { input: filete, left: 80, top: alto - 140 },
    ])
    .jpeg({ quality: 82 })
    .toBuffer();
  return new NextResponse(new Uint8Array(jpg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      "X-Robots-Tag": "noindex",
    },
  });
}
