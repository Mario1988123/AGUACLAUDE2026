import { NextResponse } from "next/server";
import { generateSepaXmlForPendingDebits } from "@/modules/sepa/sepa-xml";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await generateSepaXmlForPendingDebits();
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return new NextResponse(r.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${r.filename}"`,
      "X-Sepa-Transactions": String(r.transactions),
      "X-Sepa-Total-Cents": String(r.total_cents),
    },
  });
}
