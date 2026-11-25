import { NextResponse } from "next/server";
import { entrarComo, volverASuperadmin, type RespuestaComo } from "@/modules/superadmin/entrar-como";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * «Entrar como» y «Volver a superadmin». POST con JSON y mismo origen: un
 * formulario de otra web no puede mandarlo sin preflight. Quién puede entrar
 * lo decide entrarComo() contra la tabla `superadmins`, no esta ruta.
 */
function mismoOrigen(req: Request): boolean {
  const origen = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origen || !host) return false;
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

function responder(r: RespuestaComo, status = 200) {
  return NextResponse.json(r, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!mismoOrigen(req) || !(req.headers.get("content-type") ?? "").includes("application/json")) {
    return responder({ ok: false, error: "Petición no válida." }, 403);
  }
  let cuerpo: Record<string, unknown> = {};
  try {
    const j = (await req.json()) as unknown;
    if (j && typeof j === "object") cuerpo = j as Record<string, unknown>;
  } catch {
    return responder({ ok: false, error: "Petición no válida." }, 400);
  }
  if (cuerpo.accion === "volver") return responder(await volverASuperadmin());
  if (cuerpo.accion === "entrar") return responder(await entrarComo(cuerpo.userId));
  return responder({ ok: false, error: "Petición no válida." }, 400);
}
