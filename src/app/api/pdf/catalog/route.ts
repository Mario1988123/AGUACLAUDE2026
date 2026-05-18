import { NextResponse } from "next/server";
import { generateProductCatalog } from "@/modules/products/catalog-pdf";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    if (!session.company_id) {
      return NextResponse.json({ error: "Sin empresa" }, { status: 400 });
    }
    const bytes = await generateProductCatalog(session.company_id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="catalogo-productos.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando catálogo" },
      { status: 500 },
    );
  }
}
