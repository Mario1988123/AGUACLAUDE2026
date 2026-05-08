import { NextResponse } from "next/server";
import { generateSavingsPdf } from "@/modules/savings/pdf-generator";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const bytes = await generateSavingsPdf(id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ahorro-${id}.pdf"`,
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
