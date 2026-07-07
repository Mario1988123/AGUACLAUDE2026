import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { generateProductDatasheet } from "@/modules/products/datasheet-pdf";
import { generateProductDatasheetV2 } from "@/modules/products/datasheet-pdf-v2";
import { generateProductDatasheetIagua } from "@/modules/products/datasheet-iagua";
import { generateProductDatasheetIaguaHtml } from "@/modules/products/datasheet-iagua-html";
import { generateProductDatasheetAuto } from "@/modules/products/datasheet-pick";

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

  // SEGURIDAD (audit 2026-07-06): sin esto, cualquier usuario autenticado podía
  // leer la ficha de CUALQUIER producto por UUID (los generadores leen el
  // producto con admin client, que salta RLS, sin filtrar company_id).
  // Validamos sesión + pertenencia del producto a la empresa antes de generar.
  const session = await requireSession();
  if (!session.company_id) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: owned } = await admin
    .from("products")
    .select("id")
    .eq("id", id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  }

  const url = new URL(req.url);
  const wantsV1 =
    url.searchParams.get("v") === "1" || process.env.DATASHEET_USE_V1 === "true";
  // Override de plantilla por query para previsualizar: ?t=iagua | ?t=standard
  const forced = url.searchParams.get("t");
  // Motor nuevo HTML→PDF (satori) para la IAGUA, en pruebas: ?engine=html
  const engine = url.searchParams.get("engine");
  try {
    const bytes =
      engine === "html"
        ? await generateProductDatasheetIaguaHtml(id)
        : wantsV1
          ? await generateProductDatasheet(id)
          : forced === "iagua"
            ? await generateProductDatasheetIagua(id)
            : forced === "standard"
              ? await generateProductDatasheetV2(id)
              : await generateProductDatasheetAuto(id);
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
