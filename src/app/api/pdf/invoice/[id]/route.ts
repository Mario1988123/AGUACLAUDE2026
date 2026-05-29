import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/auth/session";
import { generateInvoicePdf } from "@/modules/invoices/pdf-generator";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Gate de rol: el PDF de factura es documento fiscal. Solo admin, dirección
  // comercial/técnica y superadmin. (Empresa validada vía RLS en getInvoice.)
  const session = await requireSession();
  const canDownload =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director");
  if (!canDownload) {
    return NextResponse.json(
      { error: "forbidden", message: "Tu rol no permite descargar facturas." },
      { status: 403 },
    );
  }
  try {
    const bytes = await generateInvoicePdf(id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura-${id}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando PDF" },
      { status: 500 },
    );
  }
}
