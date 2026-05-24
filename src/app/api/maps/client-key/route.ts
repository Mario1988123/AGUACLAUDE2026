import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/auth/session";
import {
  getClientKeyForCompany,
  loadGoogleMapsConfig,
} from "@/shared/lib/google-maps/config";

/**
 * Devuelve la API key de Google Maps válida para uso client-side
 * (Maps JS, Places Autocomplete) de la empresa del usuario. Incluye
 * además las features activas para que el cliente pueda decidir si
 * mostrar Street View, mapas interactivos, etc. sin extra round-trip.
 *
 * Requiere sesión. Si la empresa no tiene gmaps activo, responde
 * `{ key: null, mode: "disabled", features: {} }` para que el cliente
 * caiga a OSM o se oculte.
 *
 * NUNCA devuelve la server key; solo la pública (NEXT_PUBLIC_*) o la
 * own_key descifrada de BD.
 */
export async function GET() {
  try {
    const session = await requireSession();
    if (!session.company_id) {
      return NextResponse.json(
        {
          key: null,
          mode: "disabled" as const,
          features: {},
        },
        { headers: { "Cache-Control": "private, max-age=60" } },
      );
    }
    const { key, mode } = await getClientKeyForCompany(session.company_id);
    const cfg = await loadGoogleMapsConfig(session.company_id);
    return NextResponse.json(
      { key, mode, features: cfg.features },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch {
    return NextResponse.json(
      { key: null, mode: "disabled" as const, features: {} },
      { status: 200 },
    );
  }
}
