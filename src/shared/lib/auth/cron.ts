import "server-only";
import crypto from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Verifica el secreto compartido de los endpoints `/api/cron/*`.
 *
 * Fail-closed: si `CRON_SECRET` no está definida, rechaza con 500. Antes el
 * check se saltaba cuando faltaba la variable, dejando los crons públicos.
 * Acepta `Authorization: Bearer <secret>` (Vercel Cron) o `x-cron-secret`.
 * Comparación timing-safe.
 *
 * Devuelve una `NextResponse` de error si la petición no es válida, o `null`
 * si está autorizada (el caller continúa).
 */
export function verifyCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET no configurada en el servidor" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const xCron = req.headers.get("x-cron-secret") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : xCron;
  if (!provided || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
