"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Camera, MapPinOff, Settings } from "lucide-react";
import { getGoogleMapsAvailability } from "@/shared/lib/google-maps/loader";

type Status =
  | "loading"
  | "ok"
  | "no_image"      // Google no tiene cobertura en ese punto
  | "feature_off"   // admin no ha activado street_view
  | "disabled";     // empresa sin Google Maps Tools

/**
 * Foto Street View de la posición indicada. Decisión sobre qué mostrar
 * basada en /api/maps/client-key (que ahora incluye features).
 * No se oculta silenciosamente: cada estado muestra placeholder claro.
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
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const avail = await getGoogleMapsAvailability();
      if (cancelled) return;
      if (!avail.available) {
        setStatus("disabled");
        return;
      }
      if (!avail.features.street_view) {
        setStatus("feature_off");
        return;
      }
      // ok provisional, la img dispará onLoad/onError
      setStatus("ok");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) < 0.001 ||
    Math.abs(lng) < 0.001
  ) {
    return null;
  }

  // Si la empresa no tiene Google Maps activo, no spameamos placeholder
  if (status === "disabled") return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Camera className="h-3 w-3" />
        Vista de la fachada {label ? `· ${label}` : ""}
      </div>
      {status === "loading" && (
        <div
          className="flex items-center justify-center rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground"
          style={{ height }}
        >
          Cargando Street View…
        </div>
      )}
      {status === "ok" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/maps/streetview?lat=${lat}&lng=${lng}&w=640&h=${height * 2}&fov=80`}
          alt={label ?? "Street View"}
          className="w-full rounded-xl border border-border object-cover"
          style={{ height }}
          onError={() => setStatus("no_image")}
        />
      )}
      {status === "no_image" && (
        <div
          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/30 px-3 text-center text-xs text-muted-foreground"
          style={{ height }}
        >
          <MapPinOff className="h-4 w-4" />
          <p>Sin cobertura Street View en este punto.</p>
          <p className="text-[10px]">
            El coche de Google aún no ha recorrido esta calle.
          </p>
        </div>
      )}
      {status === "feature_off" && (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 px-3 text-center text-xs text-amber-900"
          style={{ height }}
        >
          <Camera className="h-5 w-5" />
          <p className="font-semibold">Street View desactivado</p>
          <p className="text-[11px]">
            El admin puede activarlo en Google Maps Tools.
          </p>
          <Link
            href="/configuracion/google-maps"
            className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2 py-1 font-bold text-amber-800 hover:bg-amber-100"
          >
            <Settings className="h-3 w-3" />
            Configurar
          </Link>
        </div>
      )}
      {status === "ok" && (
        <p className="text-[10px] text-muted-foreground">
          Imagen Google Street View.
        </p>
      )}
    </div>
  );
}
