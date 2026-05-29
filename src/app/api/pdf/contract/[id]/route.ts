import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/auth/session";
import { generateContractPdf } from "@/modules/contracts/pdf-generator";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Gate de rol: el contrato es un documento sensible. Solo los roles que
  // gestionan ventas/operaciones pueden descargarlo por URL. Telemarketers e
  // instaladores NO. (La empresa ya se valida vía RLS en generateContractPdf.)
  const session = await requireSession();
  const canDownload =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("sales_rep");
  if (!canDownload) {
    return NextResponse.json(
      { error: "forbidden", message: "Tu rol no permite descargar contratos." },
      { status: 403 },
    );
  }
  try {
    const bytes = await generateContractPdf(id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contrato-${id}.pdf"`,
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
