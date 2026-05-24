"use client";

import { useState } from "react";
import { Camera } from "lucide-react";

/**
 * Muestra una foto Street View de la posición indicada. La obtiene del
 * proxy /api/maps/streetview (que verifica sesión + feature activa).
 * Si la empresa no tiene la feature street_view, el endpoint devuelve
 * 404 y aquí ocultamos el bloque (no spamea hueco vacío).
 */
export function StreetViewCard({
  lat,
  lng,
  label,
  height = 220,
}: {
  lat: number | null;
  lng: number | null;
  label?: string;
  height?: number;
}) {
  const [errored, setErrored] = useState(false);
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) < 0.001 ||
    Math.abs(lng) < 0.001 ||
    errored
  ) {
    return null;
  }
  const src = `/api/maps/streetview?lat=${lat}&lng=${lng}&w=640&h=${height * 2}&fov=80`;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Camera className="h-3 w-3" />
        Vista de la fachada {label ? `· ${label}` : ""}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label ?? "Street View"}
        className="w-full rounded-xl border border-border object-cover"
        style={{ height }}
        onError={() => setErrored(true)}
        loading="lazy"
      />
      <p className="text-[10px] text-muted-foreground">
        Imagen Google Street View. Si el cliente no aparece, la calle aún no
        ha sido recorrida por el coche de Google.
      </p>
    </div>
  );
}
