import { NextResponse } from "next/server";
import { generateFreeTrialDeliveryNotePdf } from "@/modules/free-trials/pdf-generator";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const bytes = await generateFreeTrialDeliveryNotePdf(id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="albaran-prueba-${id.slice(0, 8)}.pdf"`,
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
