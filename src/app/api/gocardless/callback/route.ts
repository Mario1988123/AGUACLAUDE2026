/**
 * Callback de GoCardless tras firmar el cliente un mandato.
 *
 * GoCardless redirige al cliente a esta URL con `redirect_flow_id` en
 * query string. Nosotros añadimos `session_token` y `return_path` al
 * crear el flow.
 */
import { type NextRequest, NextResponse } from "next/server";
import { completeRedirectFlowAndCreateMandate } from "@/modules/gocardless/actions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const redirectFlowId = searchParams.get("redirect_flow_id");
  const sessionToken = searchParams.get("session_token");
  const returnPath = searchParams.get("return_path") ?? "/clientes";

  if (!redirectFlowId || !sessionToken) {
    return NextResponse.redirect(
      new URL(`${returnPath}?gocardless_error=missing_params`, req.url),
    );
  }
  try {
    await completeRedirectFlowAndCreateMandate({
      redirect_flow_id: redirectFlowId,
      session_token: sessionToken,
    });
    return NextResponse.redirect(new URL(`${returnPath}?gocardless=ok`, req.url));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.redirect(
      new URL(`${returnPath}?gocardless_error=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
