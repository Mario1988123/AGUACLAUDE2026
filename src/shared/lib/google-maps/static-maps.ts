"use server";

import { canUseGoogleMaps, trackGoogleApiCall } from "./config";

/**
 * Genera PNG de Static Maps de Google y lo devuelve como base64 listo
 * para embeber en PDFs (pdf-lib `embedPng`). Si la empresa no tiene la
 * feature `static_pdfs` activa o la imagen falla, devuelve null y el
 * caller debe omitir el mapa en el PDF.
 *
 * Tracking automático por llamada exitosa o errónea.
 */
export async function fetchStaticMapPng(args: {
  companyId: string;
  userId?: string | null;
  lat: number;
  lng: number;
  zoom?: number;
  width?: number;
  height?: number;
  /** marker color override (default rojo) */
  markerColor?: string;
}): Promise<{ data: Uint8Array; mime: "image/png" } | null> {
  const gm = await canUseGoogleMaps({
    companyId: args.companyId,
    feature: "static_pdfs",
  });
  if (!gm.ok) return null;

  const width = args.width ?? 640;
  const height = args.height ?? 320;
  const zoom = args.zoom ?? 16;
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${args.lat},${args.lng}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", `${width}x${height}`);
  url.searchParams.set("scale", "2"); // retina, 2× resolución
  url.searchParams.set("language", "es");
  url.searchParams.set("region", "es");
  url.searchParams.set(
    "markers",
    `color:${args.markerColor ?? "red"}|${args.lat},${args.lng}`,
  );
  url.searchParams.set("key", gm.key);

  try {
    const res = await fetch(url.toString(), {
      // El PDF se regenera por petición, no cache aggressive
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      await trackGoogleApiCall({
        companyId: args.companyId,
        api: "static_maps",
        endpoint: "staticmap",
        userId: args.userId ?? null,
        success: false,
        errorCode: `http_${res.status}`,
      });
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    await trackGoogleApiCall({
      companyId: args.companyId,
      api: "static_maps",
      endpoint: "staticmap",
      userId: args.userId ?? null,
    });
    return { data: buf, mime: "image/png" };
  } catch {
    await trackGoogleApiCall({
      companyId: args.companyId,
      api: "static_maps",
      endpoint: "staticmap",
      userId: args.userId ?? null,
      success: false,
      errorCode: "fetch_failed",
    });
    return null;
  }
}

/**
 * Genera URL de Street View que devuelve la fachada del punto.
 * Si la empresa no tiene la feature `street_view` activa o no hay key,
 * devuelve null. El cliente puede mostrarla en un <img src=...>.
 *
 * NOTA: Esta función se llama desde server actions que ya descifran la
 * key — devuelve la URL con la key incrustada. Para uso en <img> del
 * cliente, el caller debe convertirla en un endpoint /api/maps/streetview
 * proxy que no exponga la key (ver streetview/route.ts).
 */
export async function buildStreetViewUrl(args: {
  companyId: string;
  lat: number;
  lng: number;
  heading?: number;
  pitch?: number;
  width?: number;
  height?: number;
}): Promise<string | null> {
  const gm = await canUseGoogleMaps({
    companyId: args.companyId,
    feature: "street_view",
  });
  if (!gm.ok) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/streetview");
  url.searchParams.set("location", `${args.lat},${args.lng}`);
  url.searchParams.set("size", `${args.width ?? 600}x${args.height ?? 300}`);
  if (args.heading != null) url.searchParams.set("heading", String(args.heading));
  if (args.pitch != null) url.searchParams.set("pitch", String(args.pitch));
  url.searchParams.set("key", gm.key);
  return url.toString();
}
