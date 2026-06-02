/**
 * Endpoint PÚBLICO para descargar/visualizar el PDF de un contrato vía
 * token de firma remota. Sin sesión: el `token` actúa como credencial
 * temporal. Se valida contra `contract_remote_signatures`.
 *
 * Lo usa el cliente que recibe el email de "firma este contrato" — el
 * botón "Ver PDF" apunta aquí. NO requiere que el cliente tenga cuenta
 * en el CRM.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { generateContractPdf } from "@/modules/contracts/pdf-generator";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "invalid token" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Validar token: existe, no caducado, no cancelado.
  const { data: row } = await admin
    .from("contract_remote_signatures")
    .select("contract_id, expires_at, cancelled_at")
    .eq("token", token)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "token not found" }, { status: 404 });
  }
  const r = row as {
    contract_id: string;
    expires_at: string;
    cancelled_at: string | null;
  };
  if (r.cancelled_at) {
    return NextResponse.json({ error: "token cancelled" }, { status: 410 });
  }
  if (new Date(r.expires_at) < new Date()) {
    return NextResponse.json({ error: "token expired" }, { status: 410 });
  }

  try {
    const bytes = await generateContractPdf(r.contract_id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contrato-${r.contract_id}.pdf"`,
        "Cache-Control": "no-store",
        // No indexar — es contenido por token, no público de verdad.
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando PDF" },
      { status: 500 },
    );
  }
}
