import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/shared/lib/auth/session";
import {
  canUseGoogleMaps,
  trackGoogleApiCall,
} from "@/shared/lib/google-maps/config";

/**
 * Proxy de Street View. El cliente llama a /api/maps/streetview?lat=...&lng=...
 * y respondemos con la imagen JPEG si la empresa tiene la feature activa.
 * Nunca exponemos la API key al cliente.
 *
 * Tracking automático por llamada.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session.company_id) return new NextResponse(null, { status: 403 });

    const sp = req.nextUrl.searchParams;
    const lat = Number(sp.get("lat"));
    const lng = Number(sp.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return new NextResponse(null, { status: 400 });
    }
    const heading = sp.get("heading");
    const pitch = sp.get("pitch");
    const fov = sp.get("fov");
    const w = Math.min(Number(sp.get("w") ?? 600), 640);
    const h = Math.min(Number(sp.get("h") ?? 300), 640);

    const gm = await canUseGoogleMaps({
      companyId: session.company_id,
      feature: "street_view",
    });
    if (!gm.ok) {
      return new NextResponse(null, { status: 404, statusText: gm.reason });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/streetview");
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("size", `${w}x${h}`);
    if (heading) url.searchParams.set("heading", heading);
    if (pitch) url.searchParams.set("pitch", pitch);
    if (fov) url.searchParams.set("fov", fov);
    url.searchParams.set("key", gm.key);

    const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
    if (!res.ok) {
      await trackGoogleApiCall({
        companyId: session.company_id,
        api: "street_view",
        endpoint: "streetview",
        userId: session.user_id,
        success: false,
        errorCode: `http_${res.status}`,
      });
      return new NextResponse(null, { status: 404 });
    }
    const buf = await res.arrayBuffer();
    await trackGoogleApiCall({
      companyId: session.company_id,
      api: "street_view",
      endpoint: "streetview",
      userId: session.user_id,
    });
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
