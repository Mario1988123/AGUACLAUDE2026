/**
 * Callback de GoCardless tras firmar el cliente un mandato.
 *
 * GoCardless redirige al cliente a esta URL con `redirect_flow_id` en
 * query string. Nosotros añadimos `session_token` y `return_path` al
 * crear el flow.
 *
 * I20 (auditoría 2026-10-01): `return_path` solo puede ser una ruta interna
 * (rutaRetornoSegura) y ya no se refleja el mensaje de la excepción en la URL;
 * se registra en el log y al usuario le llega un código fijo.
 */
import { type NextRequest, NextResponse } from "next/server";
import { completeRedirectFlowAndCreateMandate } from "@/modules/gocardless/actions";
import { conParametro, rutaRetornoSegura } from "./ruta-retorno";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const redirectFlowId = searchParams.get("redirect_flow_id");
  const sessionToken = searchParams.get("session_token");
  const returnPath = rutaRetornoSegura(searchParams.get("return_path"));

  if (!redirectFlowId || !sessionToken) {
    return NextResponse.redirect(
      new URL(conParametro(returnPath, "gocardless_error", "missing_params"), req.url),
    );
  }
  try {
    await completeRedirectFlowAndCreateMandate({
      redirect_flow_id: redirectFlowId,
      session_token: sessionToken,
    });
    return NextResponse.redirect(new URL(conParametro(returnPath, "gocardless", "ok"), req.url));
  } catch (e) {
    console.error("[gocardless/callback]", e instanceof Error ? e.message : e);
    return NextResponse.redirect(
      new URL(conParametro(returnPath, "gocardless_error", "mandate_failed"), req.url),
    );
  }
}
