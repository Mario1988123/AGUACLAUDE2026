import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { decodeUrlSafe, destinoClicPermitido } from "@/modules/mailing/tracking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint público de tracking de CLIC en enlaces del email (SMTP).
 *  - GET /api/track/click/[id]?u=<base64url(target)>
 *  - Registra el clic en email_outbox y redirige al destino real.
 *
 * Anti open-redirect (auditoría 2026-10-01, I20): antes redirigía a cualquier
 * http(s) aunque el id no existiera. Ahora solo redirige si el id es un
 * correo real de email_outbox y el destino aparece como enlace en su HTML
 * original (destinoClicPermitido). En otro caso, 404 sin redirección.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const encoded = url.searchParams.get("u") ?? "";
  const target = decodeUrlSafe(encoded);
  if (!target) {
    return NextResponse.json({ error: "bad target" }, { status: 400 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let row: {
    body_html: string | null;
    clicks_count: number | null;
    clicked_at: string | null;
  } | null = null;
  try {
    const { data } = await admin
      .from("email_outbox")
      .select("body_html, clicks_count, clicked_at")
      .eq("id", id)
      .maybeSingle();
    row = data ?? null;
  } catch {
    row = null;
  }
  if (!row || !destinoClicPermitido(target, row.body_html)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Registrar el clic (fail-soft: si la BD falla seguimos redirigiendo
  // para no romper la experiencia del usuario que pulsó el enlace).
  try {
    const now = new Date().toISOString();
    await admin
      .from("email_outbox")
      .update({
        clicks_count: (row.clicks_count ?? 0) + 1,
        clicked_at: row.clicked_at ?? now,
        last_event_at: now,
      })
      .eq("id", id);
  } catch {
    /* fail-soft */
  }

  return NextResponse.redirect(target, 302);
}
