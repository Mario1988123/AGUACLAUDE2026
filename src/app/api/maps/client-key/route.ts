import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/auth/session";
import { getClientKeyForCompany } from "@/shared/lib/google-maps/config";

/**
 * Devuelve la API key de Google Maps válida para uso client-side
 * (Maps JS, Places Autocomplete) de la empresa del usuario. Requiere
 * sesión. Si la empresa no tiene gmaps activo o sin key, responde
 * `{ key: null, mode: "disabled" }` para que el cliente caiga a OSM.
 *
 * NUNCA devuelve la server key (GOOGLE_MAPS_PLATFORM_SERVER_KEY); solo
 * la pública (NEXT_PUBLIC_GOOGLE_MAPS_KEY o la own_key descifrada de BD).
 * La key pública debe estar restringida por referrer en Google Cloud.
 */
export async function GET() {
  try {
    const session = await requireSession();
    if (!session.company_id) {
      return NextResponse.json(
        { key: null, mode: "disabled" as const },
        { headers: { "Cache-Control": "private, max-age=60" } },
      );
    }
    const { key, mode } = await getClientKeyForCompany(session.company_id);
    return NextResponse.json(
      { key, mode },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch {
    return NextResponse.json(
      { key: null, mode: "disabled" as const },
      { status: 200 },
    );
  }
}
