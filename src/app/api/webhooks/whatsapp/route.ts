import { type NextRequest, NextResponse } from "next/server";
import { verificarFirmaMeta, tokenVerificacionValido, type CargaMeta } from "@/modules/captacion/logica";
import { registrarCarga } from "@/modules/captacion/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Webhook único de la app de Meta de Vercomi para la Cloud API de WhatsApp
 * (módulo captacion). Un solo endpoint para todas las empresas: la empresa
 * sale del phone_number_id (o del waba_id) de cada cambio.
 *
 * GET  → alta del webhook en el panel de Meta: compara hub.verify_token con
 *        META_WEBHOOK_VERIFY_TOKEN y devuelve hub.challenge.
 * POST → X-Hub-Signature-256 = HMAC-SHA256(cuerpo crudo, META_APP_SECRET).
 *        Sin firma válida: 401 y nada se guarda.
 *
 * Meta reintenta hasta 7 días si no recibe un 200; los duplicados los frena
 * la clave_dedupe única de captacion_webhook_eventos.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const modo = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const reto = p.get("hub.challenge");
  if (
    modo === "subscribe" &&
    reto &&
    tokenVerificacionValido(token, process.env.META_WEBHOOK_VERIFY_TOKEN)
  ) {
    return new NextResponse(reto, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const crudo = await req.text();
  const firma = req.headers.get("x-hub-signature-256");
  const secreto = process.env.META_APP_SECRET;

  if (!secreto) {
    console.error("[captacion/webhook] META_APP_SECRET sin configurar: se rechaza todo");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!verificarFirmaMeta(crudo, firma, secreto)) {
    console.warn("[captacion/webhook] firma no válida", {
      conFirma: Boolean(firma),
      bytes: crudo.length,
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let carga: CargaMeta;
  try {
    carga = JSON.parse(crudo) as CargaMeta;
  } catch {
    // Firmado por Meta pero ilegible: no tiene sentido que lo reintente.
    return NextResponse.json({ ok: true, ignorado: "json" });
  }

  try {
    const r = await registrarCarga(carga);
    if (r.sinEmpresa > 0) {
      console.warn("[captacion/webhook] eventos sin empresa", { sinEmpresa: r.sinEmpresa });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Fallo nuestro (base de datos): 500 para que Meta lo reintente.
    console.error("[captacion/webhook] no se pudo registrar", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
