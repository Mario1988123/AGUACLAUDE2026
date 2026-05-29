import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { decodeUrlSafe } from "@/modules/mailing/tracking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint público de tracking de CLIC en enlaces del email (SMTP).
 *  - GET /api/track/click/[id]?u=<base64url(target)>
 *  - Registra el clic en email_outbox y redirige al destino real.
 *  - Si el target no es http/https devolvemos 400 (anti open-redirect).
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
    return NextResponse.json(
      { error: "bad target" },
      { status: 400 },
    );
  }

  // Registrar el clic (fail-soft: si la BD falla seguimos redirigiendo
  // para no romper la experiencia del usuario que pulsó el enlace).
  if (/^[0-9a-f-]{20,40}$/i.test(id)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const now = new Date().toISOString();
      const { data } = await admin
        .from("email_outbox")
        .select("clicks_count, clicked_at")
        .eq("id", id)
        .maybeSingle();
      if (data) {
        const row = data as {
          clicks_count: number | null;
          clicked_at: string | null;
        };
        const newCount = (row.clicks_count ?? 0) + 1;
        await admin
          .from("email_outbox")
          .update({
            clicks_count: newCount,
            clicked_at: row.clicked_at ?? now,
            last_event_at: now,
          })
          .eq("id", id);
      }
    } catch {
      /* fail-soft */
    }
  }

  return NextResponse.redirect(target, 302);
}
