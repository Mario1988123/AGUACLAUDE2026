import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/auth/session";
import { generateWorkReportPdf } from "@/modules/installations/pdf-generator";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Gate de rol: el parte de trabajo es operativo. Lo ven admin, dirección,
  // instaladores y comerciales. Telemarketers NO. (Empresa validada vía RLS
  // en generateWorkReportPdf.)
  const session = await requireSession();
  const canDownload =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("installer") ||
    session.roles.includes("sales_rep");
  if (!canDownload) {
    return NextResponse.json(
      { error: "forbidden", message: "Tu rol no permite descargar partes de trabajo." },
      { status: 403 },
    );
  }
  try {
    const bytes = await generateWorkReportPdf(id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="parte-trabajo-${id}.pdf"`,
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
