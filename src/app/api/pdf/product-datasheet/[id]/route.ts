import { NextResponse } from "next/server";
import { generateProductDatasheet } from "@/modules/products/datasheet-pdf";
import { generateProductDatasheetV2 } from "@/modules/products/datasheet-pdf-v2";

export const dynamic = "force-dynamic";

/**
 * Endpoint de la ficha técnica de un producto.
 *
 * Por defecto sirve el rediseño v2 (Fase 3 del Plan Productos v2,
 * 2026-06-04). Si se quiere volver al diseño original, basta con definir
 * la env var `DATASHEET_USE_V1=true` o pedir explícitamente `?v=1` en la
 * URL.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const wantsV1 =
    url.searchParams.get("v") === "1" || process.env.DATASHEET_USE_V1 === "true";
  try {
    const bytes = wantsV1
      ? await generateProductDatasheet(id)
      : await generateProductDatasheetV2(id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ficha-tecnica-${id}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando ficha técnica" },
      { status: 500 },
    );
  }
}
