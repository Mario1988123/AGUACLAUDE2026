"use server";

import { requireSession } from "@/shared/lib/auth/session";
import { forwardGeocodeAction } from "@/shared/lib/geocoding/actions";
import { calculateDrivingRoute } from "@/shared/lib/routing/osrm";

export interface RouteCalc {
  km: number;
  duration_minutes: number;
  origin_label: string;
  destination_label: string;
  origin_coords: { lat: number; lng: number };
  destination_coords: { lat: number; lng: number };
}

/**
 * Calcula los kilómetros en CARRETERA entre dos direcciones de texto.
 * Geocodifica cada una con Nominatim y luego pide la ruta a OSRM público.
 * Devuelve km redondeados al alza (favorece al técnico) y duración en min.
 *
 * Si alguna fase falla (geocoding, ruta), devuelve null para que el form
 * pida al usuario meter los km a mano.
 */
export async function calculateRouteAction(
  origin: string,
  destination: string,
): Promise<RouteCalc | null> {
  await requireSession();
  if (!origin?.trim() || !destination?.trim()) return null;

  const [orig, dest] = await Promise.all([
    forwardGeocodeAction(`${origin}, España`),
    forwardGeocodeAction(`${destination}, España`),
  ]);
  if (!orig || !dest) return null;

  const route = await calculateDrivingRoute(orig.lat, orig.lng, dest.lat, dest.lng);
  if (!route) return null;

  return {
    km: Math.ceil(route.distance_m / 1000),
    duration_minutes: Math.round(route.duration_s / 60),
    origin_label: origin.trim(),
    destination_label: destination.trim(),
    origin_coords: { lat: orig.lat, lng: orig.lng },
    destination_coords: { lat: dest.lat, lng: dest.lng },
  };
}
