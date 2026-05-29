import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint público de tracking de APERTURA de email (SMTP).
 *  - GET /api/track/open/[id] → registra la apertura en email_outbox y
 *    devuelve un GIF 1x1 transparente.
 *  - Tolerante: si el id no existe (caso: caller no insertó email_outbox),
 *    seguimos devolviendo el pixel para no romper la imagen en el email.
 */
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  "base64",
);

function pixelResponse(): NextResponse {
  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.byteLength),
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Validación mínima: UUID-like. Si no, devolvemos el pixel sin tocar BD.
  if (!/^[0-9a-f-]{20,40}$/i.test(id)) return pixelResponse();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const now = new Date().toISOString();
    // Leer el contador actual para incrementar (Supabase no expone .increment
    // en update; pedimos opens_count primero, luego sumamos).
    const { data } = await admin
      .from("email_outbox")
      .select("opens_count, opened_at")
      .eq("id", id)
      .maybeSingle();
    if (!data) return pixelResponse();
    const row = data as { opens_count: number | null; opened_at: string | null };
    const newCount = (row.opens_count ?? 0) + 1;
    await admin
      .from("email_outbox")
      .update({
        opens_count: newCount,
        opened_at: row.opened_at ?? now,
        last_event_at: now,
      })
      .eq("id", id);
  } catch {
    /* fail-soft: nunca romper la imagen */
  }

  return pixelResponse();
}
